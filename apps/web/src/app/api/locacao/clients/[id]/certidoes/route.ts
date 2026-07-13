import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { ensureLocacaoAccess, isRouteError } from "@/lib/locacao/route-helpers";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { endpointInfo } from "@/lib/certidoes/endpoints";
import { sanitizePayload } from "@/lib/certidoes/infosimples";
import { runBatch } from "@/lib/certidoes/executor";

export const runtime = "nodejs";
export const maxDuration = 60;

function onlyDigits(s: unknown): string {
  return typeof s === "string" ? s.replace(/\D/g, "") : "";
}

/** Aceita "YYYY-MM-DD" ou "DD/MM/YYYY" → "YYYY-MM-DD". Espelha planner.normalizeDate. */
function normalizeDate(d: unknown): string | null {
  if (typeof d !== "string") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const br = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : null;
}

/**
 * POST /api/locacao/clients/[id]/certidoes
 *
 * Dispara um conjunto CURADO de certidões pro cliente/prospect (não usa o planner
 * deal-centric): CNDT (trabalhista, só CPF/CNPJ) sempre; PGFN (CND Federal) quando
 * há data de nascimento (PF) ou CNPJ (PJ). Jobs Infosimples com dealId null +
 * leaseClientId — o executor anexa o PDF em LeaseClientAttachment.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await ensureLocacaoAccess(PERMISSION.CLIENT_UPDATE);
  if (isRouteError(ctx)) return ctx;

  const client = await prisma.leaseClient.findUnique({ where: { id: params.id } });
  if (!client || client.orgId !== ctx.orgId) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }

  const doc = onlyDigits(client.cpfCnpj);
  const isPJ = doc.length === 14;
  const isPF = doc.length === 11;
  if (!isPF && !isPJ) {
    return NextResponse.json(
      { error: "Preencha um CPF/CNPJ válido no cliente antes de emitir certidões." },
      { status: 422 }
    );
  }

  const data = (client.dataJson as Record<string, unknown> | null) ?? {};
  const birthdate = normalizeDate(data.data_nascimento);

  // Conjunto curado. Cada item vira um CertidaoJob.
  const planned: { endpoint: string; payload: Record<string, unknown> }[] = [];
  // CNDT — só documento.
  planned.push({
    endpoint: "tribunal/tst/cndt",
    payload: isPJ ? { cnpj: doc } : { cpf: doc },
  });
  // PGFN — PF exige nascimento; PJ só CNPJ.
  if (isPJ) {
    planned.push({
      endpoint: "receita-federal/pgfn",
      payload: { cnpj: doc, preferencia_emissao: "2via" },
    });
  } else if (birthdate) {
    planned.push({
      endpoint: "receita-federal/pgfn",
      payload: { cpf: doc, birthdate, preferencia_emissao: "2via" },
    });
  }

  const batchId = randomUUID();
  let totalCostCents = 0;

  const creates = planned.map((p) => {
    const info = endpointInfo(p.endpoint);
    totalCostCents += info.costCents;
    return prisma.certidaoJob.create({
      data: {
        leaseClientId: client.id,
        userId: ctx.userId,
        batchId,
        provider: "infosimples",
        orgId: ctx.orgId,
        endpoint: p.endpoint,
        label: `${info.label} - ${client.nome}`,
        targetKind: "locatario",
        targetIndex: 0,
        requestPayload: sanitizePayload(p.payload) as object,
        status: "pending",
        costCents: null,
        portalUrl: info.portalUrl ?? null,
      },
    });
  });

  await prisma.$transaction(creates);

  void audit(extractAuditContextFromRequest(req, ctx.orgId, ctx.userId), {
    action: "CLIENT_CREDIT_DISPATCH",
    result: "SUCCESS",
    resource: client.id,
    resourceType: "LeaseClient",
    metadata: { batchId, kind: "certidoes", jobs: creates.length, costCents: totalCostCents },
  });

  waitUntil(
    runBatch(batchId, null).catch((err) => {
      console.error("[locacao/clients/certidoes] runBatch failed", err);
    })
  );

  return NextResponse.json(
    { batchId, jobCount: creates.length, totalCostCents },
    { status: 202 }
  );
}

/** GET — lista os jobs de certidão (Infosimples) do cliente. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await ensureLocacaoAccess(PERMISSION.CLIENT_VIEW);
  if (isRouteError(ctx)) return ctx;

  const client = await prisma.leaseClient.findUnique({
    where: { id: params.id },
    select: { orgId: true },
  });
  if (!client || client.orgId !== ctx.orgId) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }

  const jobs = await prisma.certidaoJob.findMany({
    where: { leaseClientId: params.id, provider: "infosimples" },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { id: true, label: true, endpoint: true, status: true, resultData: true, portalUrl: true },
  });
  return NextResponse.json({ jobs });
}
