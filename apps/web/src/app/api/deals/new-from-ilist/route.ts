import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { DEAL_SOURCE_CHANNEL } from "@/lib/pipeline/source-channel";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { getPipelineByKind } from "@/lib/modules/resolve";
import { MODULE } from "@/lib/modules/catalog";
import { getIListConnection } from "@/lib/ilist/connection";
import { buildImportPayload } from "@/lib/ilist/import";
import { resolveManagerForCreate } from "@/lib/deals/manager";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  // PK da row do ESPELHO (org-scoped no lookup) — nunca ID cru da RexAPI.
  listingRowId: z.string().min(1),
  title: z.string().max(200).optional(),
  // Gerente responsável (feature Gerente) — opcional; a org decide se é
  // obrigatório (resolveManagerForCreate devolve 422).
  managerUserId: z.string().min(1).optional(),
});

/**
 * POST /api/deals/new-from-ilist
 *
 * Quarto caminho de criação de negócio (vendas): corretor escolhe um imóvel do
 * catálogo iList (RE/MAX) e o sistema cria SalesForm com `dataJson.imoveis[0]`
 * pré-preenchido (+ seed de comissão via ComTotalPct/corretor do listing) e
 * Deal em "Formulário". Espelha o padrão de `/api/deals/new-from-proposal`,
 * sem upload/extração — a fonte é o espelho local do iList.
 *
 * Retorna `{ formToken, dealId }` pro client redirecionar pra
 * `/f/${token}?prefilled=1`.
 */
export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, { scope: "deals:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validação falhou", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const connection = await getIListConnection(auth.org.id);
  if (!connection) {
    return NextResponse.json(
      { error: "Integração iList não habilitada para esta imobiliária" },
      { status: 409 },
    );
  }

  const listing = await prisma.iListListing.findFirst({
    where: { id: parsed.data.listingRowId, orgId: auth.org.id },
  });
  if (!listing) {
    return NextResponse.json({ error: "Imóvel não encontrado" }, { status: 404 });
  }
  if (listing.deletedAt) {
    return NextResponse.json(
      { error: "Este imóvel não está mais disponível no iList" },
      { status: 410 },
    );
  }

  const pipeline = await getPipelineByKind(auth.org.id, MODULE.VENDAS, {
    include: { stages: { orderBy: { position: "asc" } } },
  });
  if (!pipeline || pipeline.stages.length === 0) {
    return NextResponse.json({ error: "Pipeline não configurado" }, { status: 400 });
  }
  const stage = pipeline.stages.find((s) => s.name === "Formulário") ?? pipeline.stages[0];

  // Gerente responsável resolvido antes do SalesForm/Deal.
  const manager = await resolveManagerForCreate(auth.org.id, parsed.data.managerUserId);
  if (!manager.ok) {
    return NextResponse.json(
      { error: manager.error, message: manager.message },
      { status: manager.status },
    );
  }

  const payload = await buildImportPayload(listing, connection.regionId);

  // Seed do dataJson: imóvel completo + comissão do listing (quando houver).
  const dataJson: Record<string, unknown> = { imoveis: [payload.vendasImovel] };
  if (payload.comissao.totalPct || payload.comissao.corretor) {
    dataJson.comissao = {
      ...(payload.comissao.totalPct ? { percentual: payload.comissao.totalPct } : {}),
      ...(payload.comissao.corretor
        ? {
            comissionados: [
              {
                nome: payload.comissao.corretor.nome,
                creci: payload.comissao.corretor.creci ?? "",
                tipo_pessoa: "fisica",
                papel: "captador",
                ...(payload.comissao.totalPct
                  ? { percentual: payload.comissao.totalPct }
                  : {}),
              },
            ],
          }
        : {}),
    };
  }

  const enderecoCurto = payload.proposalSnapshot.endereco;
  const title = parsed.data.title?.trim() || `iList #${listing.listingCode ?? listing.ilistId} — ${enderecoCurto}`;

  const form = await prisma.salesForm.create({
    data: {
      orgId: auth.org.id,
      title,
      schemaType: "compra_venda_v1",
      dataJson: dataJson as Prisma.InputJsonValue,
      status: "rascunho",
    },
  });

  const dealsInStage = await prisma.deal.count({ where: { stageId: stage.id } });
  const deal = await prisma.deal.create({
    data: {
      pipelineId: pipeline.id,
      stageId: stage.id,
      userId: auth.actor.effectiveUserId,
      formId: form.id,
      managerUserId: manager.managerUserId,
      sourceChannel: DEAL_SOURCE_CHANNEL.ILIST,
      title,
      position: dealsInStage,
    },
  });

  audit(extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId), {
    action: "ILIST_LISTING_IMPORTED",
    result: "SUCCESS",
    resource: listing.id,
    resourceType: "IListListing",
    metadata: {
      destino: "vendas",
      dealId: deal.id,
      formToken: form.token,
      ilistId: listing.ilistId,
      listingCode: listing.listingCode,
    },
  });

  return NextResponse.json(
    { dealId: deal.id, formToken: form.token, formId: form.id },
    { status: 201 },
  );
}
