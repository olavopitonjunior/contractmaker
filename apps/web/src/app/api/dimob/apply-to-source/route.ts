import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  dealId: z.string().min(1),
  fieldKey: z.string().min(1),
  partyIndex: z.number().int().min(0).max(50).default(0),
  value: z.string().max(200),
});

type Segment = string | number;
const digits = (s: string) => (s ?? "").replace(/\D/g, "");
const toNum = (s: string) =>
  Number(String(s ?? "").replace(/\./g, "").replace(",", ".").replace(/[^0-9.-]/g, "")) || 0;

function get(obj: unknown, seg: Segment): unknown {
  if (obj == null) return undefined;
  return (obj as Record<string | number, unknown>)[seg];
}

/** Seta obj em segments criando containers no caminho. Retorna o obj (mutado). */
function setDeep(root: Record<string, unknown>, segments: Segment[], value: unknown): void {
  let cur: Record<string | number, unknown> = root as Record<string | number, unknown>;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const next = segments[i + 1];
    if (cur[seg] == null || typeof cur[seg] !== "object") {
      cur[seg] = typeof next === "number" ? [] : {};
    }
    cur = cur[seg] as Record<string | number, unknown>;
  }
  cur[segments[segments.length - 1]] = value;
}

/**
 * Resolve o caminho no dataJson + o valor coagido para um fieldKey do R04.
 * Retorna null quando o campo não é mapeável na origem.
 */
function resolveTarget(
  fieldKey: string,
  partyIndex: number,
  data: Record<string, unknown>,
  rawValue: string
): { segments: Segment[]; value: unknown } | null {
  const partyDocSub = (role: "compradores" | "vendedores") => {
    const arr = (data[role] as Array<Record<string, unknown>>) ?? [];
    const tipo = arr[partyIndex]?.tipo_pessoa;
    return tipo === "juridica" ? "cnpj" : "cpf";
  };

  switch (fieldKey) {
    case "nomeComprador":
      return { segments: ["compradores", partyIndex, "nome"], value: rawValue };
    case "nomeVendedor":
      return { segments: ["vendedores", partyIndex, "nome"], value: rawValue };
    case "cpfCnpjComprador":
      return { segments: ["compradores", partyIndex, partyDocSub("compradores")], value: digits(rawValue) };
    case "cpfCnpjVendedor":
      return { segments: ["vendedores", partyIndex, partyDocSub("vendedores")], value: digits(rawValue) };
    case "valorAlienacao":
      return { segments: ["pagamento", "valor_total"], value: toNum(rawValue) };
    case "numeroContrato":
      return { segments: ["comissao", "numero_contrato"], value: digits(rawValue) };
    case "cepImovel":
      return { segments: ["imoveis", 0, "cep"], value: digits(rawValue) };
    case "ufImovel":
      return { segments: ["imoveis", 0, "uf"], value: rawValue.trim().toUpperCase() };
    default:
      return null; // enderecoImovel etc. são ambíguos — não gravamos na origem
  }
}

/**
 * POST /api/dimob/apply-to-source
 * Grava uma correção da grade DIMOB de volta no contrato de origem (dataJson do
 * deal + salesForm + contrato mais recente). Caminho resolvido no servidor a
 * partir de um fieldKey conhecido — sem injeção de path arbitrário.
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.REPORT_EXPORT,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    json = {};
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { dealId, fieldKey, partyIndex, value } = parsed.data;

  const deal = await prisma.deal.findFirst({
    where: { id: dealId, pipeline: { orgId: ctx.orgId } },
    select: {
      id: true,
      dataJson: true,
      form: { select: { id: true, dataJson: true } },
      contracts: {
        where: { isLatest: true, kind: "contract" },
        select: { id: true, dataJson: true },
        take: 1,
      },
    },
  });
  if (!deal) return NextResponse.json({ error: "Deal não encontrado" }, { status: 404 });

  const contract = deal.contracts[0];
  if (!contract) {
    return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });
  }

  const contractData = (contract.dataJson ?? {}) as Record<string, unknown>;
  const target = resolveTarget(fieldKey, partyIndex, contractData, value);
  if (!target) {
    return NextResponse.json(
      { error: "Campo não pode ser corrigido na origem (edite pela aba Dados do negócio)." },
      { status: 422 }
    );
  }

  // Grava nas três fontes (mantém espelhos em sincronia, como signers-data).
  const writes: Promise<unknown>[] = [];

  const asJson = (o: Record<string, unknown>) => o as unknown as Prisma.InputJsonValue;

  setDeep(contractData, target.segments, target.value);
  writes.push(
    prisma.contract.update({ where: { id: contract.id }, data: { dataJson: asJson(contractData) } })
  );

  if (deal.dataJson) {
    const dealData = deal.dataJson as Record<string, unknown>;
    setDeep(dealData, target.segments, target.value);
    writes.push(prisma.deal.update({ where: { id: deal.id }, data: { dataJson: asJson(dealData) } }));
  }
  if (deal.form?.dataJson) {
    const formData = deal.form.dataJson as Record<string, unknown>;
    setDeep(formData, target.segments, target.value);
    writes.push(
      prisma.salesForm.update({ where: { id: deal.form.id }, data: { dataJson: asJson(formData) } })
    );
  }

  await Promise.all(writes);

  await audit(extractAuditContextFromRequest(req, ctx.orgId, ctx.userId), {
    action: "CONTRACT_SIGNERS_DATA_UPDATE",
    result: "SUCCESS",
    resource: contract.id,
    resourceType: "Contract",
    metadata: { via: "dimob_apply_to_source", fieldKey, path: target.segments.join(".") },
  });

  return NextResponse.json({ ok: true, path: target.segments.join(".") });
}
