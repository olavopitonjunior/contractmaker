import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";
import { guaranteeCreateSchema, type GuaranteeCreateInput } from "@/lib/locacao/validators";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.GUARANTEE_VIEW);
  if (isRouteError(ctx)) return ctx;
  const url = new URL(req.url);
  const leaseContractId = url.searchParams.get("leaseContractId");

  const guarantees = await prisma.guarantee.findMany({
    where: {
      orgId: ctx.orgId,
      ...(leaseContractId ? { leaseContractId } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ guarantees });
}

/** Mapeia o payload da união discriminada pros campos/Json do model Guarantee. */
function toGuaranteeData(data: GuaranteeCreateInput) {
  const base = {
    tipo: data.tipo,
    status: data.status,
    coberturaMeses: data.coberturaMeses ?? null,
    externalRef: data.externalRef ?? null,
    // Reset explícito: substituição não pode herdar payload da modalidade anterior.
    caucaoSubtipo: null as string | null,
    provider: null as string | null,
    custoJson: Prisma.JsonNull as Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue,
    dadosJson: Prisma.JsonNull as Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue,
    fiadorPartyJson: Prisma.JsonNull as Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue,
    documentoPdfUrl: null as string | null,
  };
  const observacoes = data.observacoes ? { observacoes: data.observacoes } : {};
  switch (data.tipo) {
    case "fiador":
      return { ...base, fiadorPartyJson: { ...data.fiador }, dadosJson: { ...observacoes } };
    case "seguro_fianca":
      return {
        ...base,
        provider: data.provider,
        custoJson: { premioMensal: data.premioMensal ?? null },
        dadosJson: { ...observacoes },
      };
    case "titulo_capitalizacao":
      return {
        ...base,
        provider: data.provider,
        dadosJson: { valorTitulo: data.valorTitulo, ...observacoes },
      };
    case "caucao":
      return {
        ...base,
        caucaoSubtipo: data.caucaoSubtipo,
        dadosJson: {
          valorCaucao: data.valorCaucao ?? null,
          dadosDeposito: data.dadosDeposito
            ? {
                ...data.dadosDeposito,
                dataDeposito: data.dadosDeposito.dataDeposito?.toISOString() ?? null,
              }
            : null,
          ...observacoes,
        },
      };
    case "garantia_digital":
      return {
        ...base,
        provider: data.provider,
        custoJson: { taxaMensal: data.taxaMensal ?? null },
        dadosJson: { ...observacoes },
      };
    case "cessao_fiduciaria":
      return {
        ...base,
        provider: data.provider ?? null,
        dadosJson: { valorCedido: data.valorCedido ?? null, ...observacoes },
      };
  }
}

export async function POST(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.GUARANTEE_MANAGE);
  if (isRouteError(ctx)) return ctx;

  const parsed = await parseJsonBody(req, guaranteeCreateSchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;

  const lc = await prisma.leaseContract.findFirst({
    where: { id: data.leaseContractId, orgId: ctx.orgId },
    select: { id: true },
  });
  if (!lc) {
    return NextResponse.json({ error: "Contrato não pertence à org." }, { status: 422 });
  }

  const existing = await prisma.guarantee.findUnique({
    where: { leaseContractId: data.leaseContractId },
  });

  if (existing && !data.substituir) {
    return NextResponse.json(
      {
        error:
          "O contrato já possui uma garantia. Use a opção de substituição para trocá-la (Lei 8.245 art. 37 permite apenas uma).",
      },
      { status: 409 }
    );
  }

  const fields = toGuaranteeData(data);

  let guarantee;
  if (existing) {
    // Substituição: snapshot da garantia atual vai pro histórico antes do overwrite.
    const historico = Array.isArray(existing.historicoJson) ? existing.historicoJson : [];
    const snapshot = {
      snapshot: {
        tipo: existing.tipo,
        caucaoSubtipo: existing.caucaoSubtipo,
        provider: existing.provider,
        status: existing.status,
        coberturaMeses: existing.coberturaMeses,
        custoJson: existing.custoJson,
        dadosJson: existing.dadosJson,
        fiadorPartyJson: existing.fiadorPartyJson,
        externalRef: existing.externalRef,
        documentoPdfUrl: existing.documentoPdfUrl,
        createdAt: existing.createdAt.toISOString(),
      },
      substituidaEm: new Date().toISOString(),
    };
    guarantee = await prisma.guarantee.update({
      where: { id: existing.id },
      data: { ...fields, historicoJson: [...historico, snapshot] as Prisma.InputJsonValue },
    });
  } else {
    guarantee = await prisma.guarantee.create({
      data: {
        orgId: ctx.orgId,
        leaseContractId: data.leaseContractId,
        ...fields,
      },
    });
  }

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: existing ? "GUARANTEE_REPLACE" : "GUARANTEE_CREATE",
      result: "SUCCESS",
      resource: guarantee.id,
      resourceType: "Guarantee",
      metadata: {
        tipo: guarantee.tipo,
        ...(existing ? { tipoAnterior: existing.tipo } : {}),
      },
    }
  );

  return NextResponse.json({ guarantee }, { status: existing ? 200 : 201 });
}
