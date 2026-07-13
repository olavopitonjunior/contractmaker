import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { ensureLocacaoAccess, isRouteError } from "@/lib/locacao/route-helpers";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { isSerasaConfigured } from "@/lib/serasa/client";
import { sanitizeSerasaPayload } from "@/lib/serasa/sanitize";
import { endpointInfo } from "@/lib/certidoes/endpoints";
import { runBatch } from "@/lib/certidoes/executor";

export const runtime = "nodejs";
export const maxDuration = 60;

function onlyDigits(s: unknown): string {
  return typeof s === "string" ? s.replace(/\D/g, "") : "";
}

interface CreditTarget {
  label: string;
  index: number;
  cpf: string | null;
  cnpj: string | null;
}

/**
 * POST /api/locacao/clients/[id]/credit-analysis
 *
 * Análise de crédito de um cliente/prospect (pré-deal): dispara Serasa Score +
 * Restritivos pro próprio cliente (e cônjuge, se houver no dataJson), reusando o
 * motor de certidões (CertidaoJob provider="serasa" + runBatch). Diferente da
 * versão de deal, os jobs carregam `leaseClientId` (dealId null) e o gate LGPD
 * lê `LeaseClient.complianceJson.serasaConsent`.
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

  if (!isSerasaConfigured()) {
    return NextResponse.json(
      { error: "Serasa não configurado (SERASA_CLIENT_ID/SECRET/BASE_URL)" },
      { status: 503 }
    );
  }

  // Gate LGPD — mesmo contrato do deal (412 + requiresConsent).
  const compliance = (client.complianceJson as Record<string, unknown> | null) ?? null;
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

  const data = (client.dataJson as Record<string, unknown> | null) ?? {};
  const conjuge = data.conjuge as { nome?: string; cpf?: string } | undefined;

  const targets: CreditTarget[] = [];
  {
    const cpf = onlyDigits(client.cpfCnpj).length === 11 ? onlyDigits(client.cpfCnpj) : null;
    const cnpj = onlyDigits(client.cpfCnpj).length === 14 ? onlyDigits(client.cpfCnpj) : null;
    if (cpf || cnpj) {
      targets.push({ label: client.nome, index: 0, cpf, cnpj });
    }
  }
  if (conjuge?.cpf && onlyDigits(conjuge.cpf).length === 11) {
    targets.push({
      label: conjuge.nome || `Cônjuge de ${client.nome}`,
      index: 1,
      cpf: onlyDigits(conjuge.cpf),
      cnpj: null,
    });
  }

  if (targets.length === 0) {
    return NextResponse.json(
      {
        error:
          "Cliente sem CPF/CNPJ válido — preencha o documento antes de analisar o crédito.",
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
          leaseClientId: client.id,
          userId: ctx.userId,
          batchId,
          provider: "serasa",
          orgId: ctx.orgId,
          endpoint,
          // targetKind "locatario" agrupa o PDF na categoria certa no executor.
          label: `${info.label} - ${t.label}`,
          targetKind: "locatario",
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
    action: "CLIENT_CREDIT_DISPATCH",
    result: "SUCCESS",
    resource: client.id,
    resourceType: "LeaseClient",
    metadata: {
      batchId,
      serasaJobs: creates.length,
      serasaCostCents: totalCostCents,
    },
  });

  waitUntil(
    runBatch(batchId, null).catch((err) => {
      console.error("[locacao/clients/credit-analysis] runBatch failed", err);
    })
  );

  return NextResponse.json(
    { batchId, jobCount: creates.length, totalCostCents },
    { status: 202 }
  );
}
