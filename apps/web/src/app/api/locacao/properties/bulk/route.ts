import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";

export const dynamic = "force-dynamic";

const STATUS_VALUES = [
  "disponivel",
  "anunciado",
  "em_negociacao",
  "locado",
  "manutencao",
  "fora_catalogo",
] as const;

const bulkSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("setStatus"),
    ids: z.array(z.string().min(1)).min(1).max(500),
    status: z.enum(STATUS_VALUES),
  }),
  z.object({
    action: z.literal("setValorAluguelSugerido"),
    ids: z.array(z.string().min(1)).min(1).max(500),
    valor: z.number().min(0).max(1_000_000),
  }),
  z.object({
    action: z.literal("exportCsv"),
    ids: z.array(z.string().min(1)).min(1).max(500),
  }),
]);

function csvEscape(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n;]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * POST /api/locacao/properties/bulk
 *
 * Ações em massa sobre Property: setStatus, setValorAluguelSugerido, exportCsv.
 * Todas escopadas em orgId. exportCsv devolve text/csv com BOM UTF-8 pra Excel BR.
 */
export async function POST(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.PROPERTY_EDIT);
  if (isRouteError(ctx)) return ctx;

  const parsed = await parseJsonBody(req, bulkSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (body.action === "exportCsv") {
    const props = await prisma.property.findMany({
      where: { id: { in: body.ids }, orgId: ctx.orgId },
      include: { ownerships: { include: { owner: { select: { nome: true } } } } },
    });
    const header = [
      "id",
      "tipo",
      "endereco",
      "bairro",
      "cidade",
      "uf",
      "cep",
      "area",
      "status",
      "valor_aluguel_sugerido",
      "matricula",
      "proprietarios",
    ];
    const rows = props.map((p) => [
      p.id,
      p.kind,
      [p.rua, p.numero].filter(Boolean).join(", "),
      p.bairro ?? "",
      p.cidade ?? "",
      p.uf ?? "",
      p.cep ?? "",
      p.area ?? "",
      p.status,
      p.valorAluguelSugerido ?? "",
      p.matricula ?? "",
      p.ownerships.map((o) => `${o.owner.nome} (${o.percentual}%)`).join(" | "),
    ]);
    const csv =
      "﻿" +
      [header, ...rows].map((r) => r.map(csvEscape).join(";")).join("\r\n");

    await audit(
      { orgId: ctx.orgId, userId: ctx.userId },
      {
        action: "PROPERTY_BULK_EXPORT",
        result: "SUCCESS",
        resource: "Property",
        resourceType: "Property",
        metadata: { count: props.length },
      }
    );

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="imoveis-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  const data: Record<string, unknown> = {};
  if (body.action === "setStatus") data.status = body.status;
  if (body.action === "setValorAluguelSugerido") data.valorAluguelSugerido = body.valor;

  const result = await prisma.property.updateMany({
    where: { id: { in: body.ids }, orgId: ctx.orgId },
    data,
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "PROPERTY_BULK_UPDATE",
      result: "SUCCESS",
      resource: "Property",
      resourceType: "Property",
      metadata: {
        action: body.action,
        count: result.count,
        ...("status" in body ? { status: body.status } : {}),
        ...("valor" in body ? { valor: body.valor } : {}),
      },
    }
  );

  return NextResponse.json({ updated: result.count });
}
