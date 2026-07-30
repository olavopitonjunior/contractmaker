import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/db/prisma";
import {
  ensureLocacaoAccess,
  isRouteError,
} from "@/lib/locacao/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { isSerasaConfigured } from "@/lib/serasa/client";
import { sanitizeSerasaPayload } from "@/lib/serasa/sanitize";
import { endpointInfo } from "@/lib/certidoes/endpoints";
import { runBatch } from "@/lib/certidoes/executor";
import { guardDealScope } from "@/lib/deals/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 60;

function onlyDigits(s: unknown): string {
  return typeof s === "string" ? s.replace(/\D/g, "") : "";
}

interface Parte {
  tipo_pessoa?: string;
  nome?: string;
  razao_social?: string;
  cpf?: string;
  cnpj?: string;
}

interface CreditTarget {
  label: string;
  papel: "locatario" | "fiador";
  index: number;
  cpf: string | null;
  cnpj: string | null;
}

/**
 * POST /api/locacao/deals/[dealId]/credit-analysis
 *
 * Análise de crédito da ficha de locação ("Em Aprovação"): dispara Serasa
 * Score + Restritivos (PF/PJ) pra cada locatário e pro fiador, reusando o
 * motor de certidões (CertidaoJob provider="serasa" + runBatch + PDF na
 * pasta). Gate LGPD igual ao de certidões: exige
 * Deal.complianceJson.serasaConsent (gravado via POST .../serasa/consent).
 *
 * Resposta 202: { batchId, jobCount, totalCostCents }. A UI acompanha via
 * GET /api/deals/[dealId]/certidoes?batchId=.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const ctx = await ensureLocacaoAccess(PERMISSION.LEASE_CREATE);
  if (isRouteError(ctx)) return ctx;

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: {
      pipeline: { select: { orgId: true } },
      form: { select: { dataJson: true } },
    },
  });
  if (!deal || deal.kind !== "locacao") {
    return NextResponse.json({ error: "Deal não encontrado" }, { status: 404 });
  }
  if (deal.pipeline.orgId !== ctx.orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Escopo do gerente — acrescentado ao ensureLocacaoAccess(LEASE_CREATE).
  const denied = await guardDealScope({
    dealId: params.dealId,
    userId: ctx.userId,
    orgId: ctx.orgId,
  });
  if (denied) return denied;

  if (!isSerasaConfigured()) {
    return NextResponse.json(
      { error: "Serasa não configurado (SERASA_CLIENT_ID/SECRET/BASE_URL)" },
      { status: 503 }
    );
  }

  // Gate LGPD — mesmo contrato do POST /certidoes (412 + requiresConsent).
  const compliance = (deal.complianceJson as Record<string, unknown> | null) ?? null;
  const consent = compliance?.serasaConsent as Record<string, unknown> | undefined;
  if (!consent || !consent.at) {
    return NextResponse.json(
      {
        error: "Consentimento LGPD não registrado para consulta Serasa",
        requiresConsent: true,
        missingFor: ["serasa"],
      },
      { status: 412 }
    );
  }

  const dataJson = (deal.form?.dataJson as Record<string, unknown> | null) ?? {};
  const locatarios = (dataJson.locatarios as Parte[] | undefined) ?? [];
  const fiador = (dataJson.garantia as { fiador?: Parte } | undefined)?.fiador;

  const targets: CreditTarget[] = [];
  locatarios.forEach((p, i) => {
    const cpf = onlyDigits(p.cpf).length === 11 ? onlyDigits(p.cpf) : null;
    const cnpj = onlyDigits(p.cnpj).length === 14 ? onlyDigits(p.cnpj) : null;
    if (cpf || cnpj) {
      targets.push({
        label: p.nome || p.razao_social || `Locatário ${i + 1}`,
        papel: "locatario",
        index: i,
        cpf,
        cnpj,
      });
    }
  });
  if (fiador) {
    const cpf = onlyDigits(fiador.cpf).length === 11 ? onlyDigits(fiador.cpf) : null;
    const cnpj = onlyDigits(fiador.cnpj).length === 14 ? onlyDigits(fiador.cnpj) : null;
    if (cpf || cnpj) {
      targets.push({
        label: fiador.nome || fiador.razao_social || "Fiador",
        papel: "fiador",
        index: 0,
        cpf,
        cnpj,
      });
    }
  }

  if (targets.length === 0) {
    return NextResponse.json(
      {
        error:
          "Nenhum locatário/fiador com CPF ou CNPJ válido no formulário — preencha a qualificação antes de analisar o crédito.",
      },
      { status: 422 }
    );
  }

  const batchId = randomUUID();
  let totalCostCents = 0;

  const creates = targets.flatMap((t) => {
    const isPJ = !!t.cnpj && !t.cpf;
    const payload = isPJ ? { cnpj: t.cnpj } : { cpf: t.cpf };
    const endpoints = isPJ
      ? ["serasa/score-pj", "serasa/restritivos-pj"]
      : ["serasa/score-pf", "serasa/restritivos-pf"];
    return endpoints.map((endpoint) => {
      const info = endpointInfo(endpoint);
      totalCostCents += info.costCents;
      return prisma.certidaoJob.create({
        data: {
          dealId: deal.id,
          userId: ctx.userId,
          batchId,
          provider: "serasa",
          orgId: ctx.orgId,
          endpoint,
          label: `${info.label} - ${t.label}`,
          // targetKind do papel de locação — usado só pra exibição/agrupamento
          // (executor Serasa lê endpoint + requestPayload).
          targetKind: t.papel,
          targetIndex: t.index,
          requestPayload: sanitizeSerasaPayload(payload) as object,
          status: "pending",
          costCents: null,
          portalUrl: info.portalUrl ?? null,
        },
      });
    });
  });

  await prisma.$transaction(creates);

  void audit(extractAuditContextFromRequest(req, ctx.orgId, ctx.userId), {
    action: "SERASA_QUERY_DISPATCH",
    result: "SUCCESS",
    resource: deal.id,
    resourceType: "Deal",
    metadata: {
      batchId,
      kind: "locacao_credit_analysis",
      targets: targets.map((t) => `${t.papel}:${t.index}`),
      serasaJobs: creates.length,
      serasaCostCents: totalCostCents,
    },
  });

  waitUntil(
    runBatch(batchId, deal.id).catch((err) => {
      console.error("[locacao/credit-analysis] runBatch failed", err);
    })
  );

  return NextResponse.json(
    { batchId, jobCount: creates.length, totalCostCents },
    { status: 202 }
  );
}
