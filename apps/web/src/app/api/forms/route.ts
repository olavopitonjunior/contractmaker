import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { DEAL_SOURCE_CHANNEL } from "@/lib/pipeline/source-channel";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { withIdempotency } from "@/lib/api/idempotency";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";
import { formPublicPath } from "@/lib/forms/form-url";
import { getPipelineByKind } from "@/lib/modules/resolve";
import { assertFeatureEnabled, ModuleDisabledError } from "@/lib/modules/guard";
import { FEATURE, MODULE } from "@/lib/modules/catalog";
import { z } from "zod";

// Janela do soft-block de título repetido (recriação manual de card).
// Não-exportado: route.ts só pode exportar handlers/config no App Router.
const DUPLICATE_WINDOW_MS = 15 * 60 * 1000;

// Validação Zod (convenção do repo). passthrough: clientes antigos (Newton)
// podem mandar campos extras sem quebrar.
const postBodySchema = z
  .object({
    title: z.string().optional(),
    // Confirma a criação apesar do soft-block de título repetido (409).
    force: z.boolean().optional(),
    // Corretores pré-selecionados do registry (SplitRecipient commissioner):
    // pré-seedam comissao.comissionados no dataJson e viram brokerIds do deal.
    corretorIds: z.array(z.string().min(1)).max(10).optional(),
    // false → Deal.notificationsJson.muted (nenhuma atualização deste negócio).
    sendUpdates: z.boolean().optional(),
  })
  .passthrough();

export async function POST(request: NextRequest) {
  const auth = await requireApiAuth(request, { scope: "documents:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  // Este endpoint cria SalesForm de vendas (schemaType compra_venda_v1).
  // Gate por sub-função Vendas → Formulário público.
  try {
    await assertFeatureEnabled(auth.org.id, FEATURE.VENDAS_FORM_PUBLICO);
  } catch (e) {
    if (e instanceof ModuleDisabledError) {
      return NextResponse.json({ error: e.code }, { status: e.status });
    }
    throw e;
  }

  const rawBody = await request.json().catch(() => ({}));
  const parsedBody = postBodySchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "invalid_body",
        issues: parsedBody.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }
  const body = parsedBody.data;
  const idempotencyKey = request.headers.get("x-idempotency-key");

  const result = await withIdempotency({
    userId: auth.actor.effectiveUserId,
    key: idempotencyKey,
    method: "POST",
    path: "/api/forms",
    handler: async (): Promise<{ status: number; body: unknown }> => {
      // Form de vendas → pipeline de vendas (kind="venda"). getPipelineByKind
      // evita pegar o pipeline de locação em orgs com os dois módulos.
      const pipeline = await getPipelineByKind(auth.org.id, MODULE.VENDAS, {
        include: { stages: { orderBy: { position: "asc" } } },
      });

      // Soft-block anti-duplicação: o padrão real observado em prod (caso
      // "Alexandre Gonçalves", 2026-07-16) é o operador recriar o form minutos
      // depois — a idempotency key não pega isso (cada tentativa é uma
      // "intenção" nova). Com título repetido em janela curta, devolve 409 pro
      // cliente confirmar; re-POST com `force: true` (e key NOVA — o 409 fica
      // cacheado na key antiga) cria mesmo assim.
      //
      // Só pra clientes INTERATIVOS (sessão): callers bearer (Newton) não têm
      // o confirm de UI — pra eles o contrato "POST sempre cria" se mantém.
      const trimmedTitle = body.title?.trim() ?? "";
      const isInteractiveCaller = auth.actor.via !== "newton";
      if (trimmedTitle && body.force !== true && isInteractiveCaller && pipeline) {
        const recentDup = await prisma.deal.findFirst({
          where: {
            pipelineId: pipeline.id,
            title: trimmedTitle,
            archivedAt: null,
            createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
          },
          select: { id: true, title: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        });
        if (recentDup) {
          return {
            status: 409,
            body: { error: "duplicate_recent", existing: recentDup },
          };
        }
      }

      // Título gravado TRIMADO — o dup-check compara contra o armazenado; um
      // espaço acidental no input não pode furar o soft-block.
      const form = await prisma.salesForm.create({
        data: {
          orgId: auth.org.id,
          title: trimmedTitle || null,
          schemaType: "compra_venda_v1",
          dataJson: {},
          status: "rascunho",
        },
      });

      let dealId: string | null = null;
      if (pipeline && pipeline.stages.length > 0) {
        const formularioStage =
          pipeline.stages.find((s) => s.name === "Formulário") ??
          pipeline.stages[0];
        const dealsInStage = await prisma.deal.count({
          where: { stageId: formularioStage.id },
        });

        const deal = await prisma.deal.create({
          data: {
            pipelineId: pipeline.id,
            stageId: formularioStage.id,
            userId: auth.actor.effectiveUserId,
            formId: form.id,
            sourceChannel: DEAL_SOURCE_CHANNEL.FORM_PUBLICO,
            title: trimmedTitle || `Negocio - ${form.token.slice(0, 8)}`,
            position: dealsInStage,
          },
        });
        dealId = deal.id;
      }

      // Corretores pré-selecionados na criação + opt-out de atualizações.
      // Org-scoped: ids alheios são silenciosamente descartados pelo where.
      if ((body.corretorIds?.length ?? 0) > 0 || body.sendUpdates === false) {
        const recipients = body.corretorIds?.length
          ? await prisma.splitRecipient.findMany({
              where: {
                id: { in: body.corretorIds },
                orgId: auth.org.id,
                kind: "commissioner",
              },
            })
          : [];

        if (recipients.length > 0) {
          // Pré-seed da etapa 7: o cliente vê os corretores já preenchidos
          // (linha verde via splitRecipientId) e só ajusta percentuais.
          const comissionados = recipients.map((r) => {
            const doc = (r.cpfCnpj ?? "").replace(/\D/g, "");
            const isPj = r.tipoPessoa === "juridica" || doc.length === 14;
            return {
              tipo_pessoa: isPj ? "juridica" : "fisica",
              nome: r.label,
              ...(isPj ? { cnpj: doc || undefined } : { cpf: doc || undefined }),
              creci: r.creci ?? undefined,
              papel: r.papel ?? "captador",
              email: r.email ?? undefined,
              mobile_phone: r.phone ?? undefined,
              splitRecipientId: r.id,
            };
          });
          await prisma.salesForm.update({
            where: { id: form.id },
            data: { dataJson: { comissao: { comissionados } } },
          });
        }

        if (dealId) {
          await prisma.deal.update({
            where: { id: dealId },
            data: {
              notificationsJson: {
                ...(recipients.length > 0
                  ? { brokerIds: recipients.map((r) => r.id) }
                  : {}),
                ...(body.sendUpdates === false ? { muted: true } : {}),
              },
            },
          });
        }
      }

      await audit(
        extractAuditContextFromRequest(
          request,
          auth.org.id,
          auth.actor.effectiveUserId
        ),
        {
          action: "FORM_CREATE",
          result: "SUCCESS",
          resource: form.id,
          resourceType: "SalesForm",
          metadata: mergeAuditMetadata(
            { token: form.token, dealId },
            auth.actor
          ),
        }
      );

      return {
        status: 201,
        body: {
          id: form.id,
          token: form.token,
          url: formPublicPath(form.token, form.title),
          dealId,
        },
      };
    },
  });

  return NextResponse.json(result.body, { status: result.status });
}

export async function GET(request: NextRequest) {
  const auth = await requireApiAuth(request, { scope: "documents:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const forms = await prisma.salesForm.findMany({
    where: { orgId: auth.org.id },
    orderBy: { createdAt: "desc" },
    include: { deal: { select: { id: true, title: true } } },
  });

  return NextResponse.json(forms);
}
