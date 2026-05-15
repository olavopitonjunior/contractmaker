import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import crypto from "crypto";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { runBatch, getMonthlySpendByProvider } from "@/lib/certidoes/executor";
import { endpointInfo } from "@/lib/certidoes/endpoints";
import { sanitizeSerasaPayload } from "@/lib/serasa/sanitize";
import { isSerasaConfigured } from "@/lib/serasa/client";
import { audit } from "@/lib/security/audit";

/**
 * POST /api/deals/:dealId/serasa/expand-vinculos
 *
 * Cria um único CertidaoJob com endpoint `serasa/vinculos-pj-pf` pra descobrir
 * CNPJs onde o CPF aparece como sócio/representante. O job é processado pelo
 * runBatch padrão; quando completa, o resultado vira `CertidaoJob.resultData.raw.vinculos[]`
 * e a UI mostra o multi-select pra adicionar como `DiligentedPerson`.
 *
 * Gates:
 *   - auth + cross-org guard (mesmo padrão do POST /certidoes).
 *   - Serasa configurado (env vars).
 *   - Consentimento LGPD do deal (Deal.complianceJson.serasaConsent).
 *   - Budget mensal Serasa.
 *
 * Body: { cpf: string (11 dígitos), targetKind?: "vendedor"|"comprador"|"diligenciado", targetIndex?: number }
 *   - targetKind/targetIndex servem só pra UI saber a qual parte do deal o
 *     resultado se refere; planner não usa.
 */

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({
  cpf: z
    .string()
    .transform((s) => s.replace(/\D/g, ""))
    .pipe(z.string().length(11, "CPF deve ter 11 dígitos")),
  targetKind: z.enum(["vendedor", "comprador", "diligenciado"]).optional(),
  targetIndex: z.number().int().min(0).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: { form: { select: { orgId: true } } },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  if (deal.form && deal.form.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isSerasaConfigured()) {
    return NextResponse.json(
      { error: "Serasa nao configurado no servidor" },
      { status: 503 }
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { cpf, targetKind, targetIndex } = parsed.data;

  // LGPD gate — mesmo do POST /certidoes. Sem consent, 412.
  const compliance = (deal.complianceJson as Record<string, unknown> | null) ?? null;
  const consent = compliance?.serasaConsent as Record<string, unknown> | undefined;
  if (!consent || !consent.at) {
    return NextResponse.json(
      {
        error: "Consentimento LGPD nao registrado para consulta Serasa",
        requiresConsent: true,
        missingFor: ["serasa"],
      },
      { status: 412 }
    );
  }

  // Budget Serasa
  const spend = await getMonthlySpendByProvider(org.id, "serasa");
  const endpoint = "serasa/vinculos-pj-pf";
  const info = endpointInfo(endpoint);
  if (spend.spentCents + info.costCents > spend.budgetCents) {
    return NextResponse.json(
      {
        error: "Este lote estouraria o budget mensal Serasa",
        spend,
        provider: "serasa",
      },
      { status: 402 }
    );
  }

  const batchId = crypto.randomUUID();
  const label = `Serasa — Vinculos do CPF ${cpf.slice(0, 3)}.***.***.${cpf.slice(-2)}`;
  const job = await prisma.certidaoJob.create({
    data: {
      dealId: params.dealId,
      orgId: org.id,
      userId: session.user.id,
      batchId,
      provider: "serasa",
      endpoint,
      label,
      targetKind: targetKind ?? "diligenciado",
      targetIndex: targetIndex ?? 0,
      requestPayload: sanitizeSerasaPayload({ cpf }) as object,
      status: "pending",
      costCents: null,
    },
  });

  void audit(
    { orgId: org.id, userId: session.user.id },
    {
      action: "SERASA_VINCULOS_EXPAND",
      result: "SUCCESS",
      resource: params.dealId,
      resourceType: "Deal",
      metadata: { batchId, jobId: job.id, cpf: cpf.slice(0, 3) + "...." },
    }
  );

  // Fire-and-forget — UI faz polling do batchId via GET /certidoes.
  waitUntil(
    runBatch(batchId, params.dealId).catch((err) => {
      console.error("[serasa/expand-vinculos] runBatch failed", err);
    })
  );

  return NextResponse.json({ batchId, jobId: job.id }, { status: 202 });
}
