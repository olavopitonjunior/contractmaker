import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { TARGET_KINDS } from "@/lib/certidoes/types";
import { loadProposalCertidoesScope } from "@/lib/certidoes/proposal-subject";
import { dispatchProposalCertidoes } from "@/lib/certidoes/proposal-dispatch";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
// > DEFAULT_TIMEOUT_MS (630s) do callInfosimples — igual à rota de Deal.
export const maxDuration = 660;

/**
 * GET /api/proposals/:id/certidoes?batchId=xxx
 *
 * Jobs da PROPOSTA no mesmo shape que a `CertidoesTab` consome do negócio.
 * O PDF de um job de proposta vive em `ProposalAttachment` (ligado por
 * `certidaoJobId`), não em `DealAttachment` — aqui ele é projetado no lugar
 * de `attachment`/`attachmentId` para a aba renderizar o link igual.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadProposalCertidoesScope(req, params.id, { write: false });
  if ("fail" in r) return r.fail;
  const { scope } = r;

  const batchId = new URL(req.url).searchParams.get("batchId");
  const jobs = await prisma.certidaoJob.findMany({
    where: { proposalId: scope.proposal.id, ...(batchId ? { batchId } : {}) },
    orderBy: { createdAt: "desc" },
  });
  const pdfs = jobs.length
    ? await prisma.proposalAttachment.findMany({
        where: { certidaoJobId: { in: jobs.map((j) => j.id) } },
        select: { id: true, filename: true, mime: true, certidaoJobId: true },
      })
    : [];
  const pdfByJob = new Map(pdfs.map((p) => [p.certidaoJobId, p]));

  return NextResponse.json({
    jobs: jobs.map((j) => {
      const pdf = pdfByJob.get(j.id) ?? null;
      return {
        ...j,
        // Sujeito da aba: `dealId` é lido só como chave de rota pelo hook —
        // aqui o hook já recebe a base explícita.
        attachmentId: pdf?.id ?? j.attachmentId,
        attachment: pdf ? { id: pdf.id, filename: pdf.filename, mime: pdf.mime } : null,
      };
    }),
    latestBatchId: jobs[0]?.batchId,
  });
}

const extractSchema = z.object({
  batchId: z.string().min(8),
  jobs: z
    .array(
      z.object({
        endpoint: z.string(),
        targetKind: z.enum(TARGET_KINDS),
        targetIndex: z.number().int().min(0),
      })
    )
    .optional(),
});

/**
 * POST /api/proposals/:id/certidoes — dispara certidões a partir da proposta
 * (`lib/certidoes/proposal-dispatch.ts`). Mesmos dois modos da rota de Deal:
 * plano padrão ou seleção explícita (`jobs`).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadProposalCertidoesScope(req, params.id, { write: true });
  if ("fail" in r) return r.fail;
  const { scope } = r;

  const parsed = extractSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const result = await dispatchProposalCertidoes({
    proposalId: scope.proposal.id,
    orgId: scope.orgId,
    userId: scope.userId,
    userEmail: scope.userEmail,
    esteira: scope.esteira,
    dataJson: scope.dataJson,
    batchId: parsed.data.batchId,
    selectedJobs: parsed.data.jobs,
  });
  if (!result.ok) return NextResponse.json(result.body, { status: result.status });

  // Mantém a Lambda viva até o lote terminar (até maxDuration). Sem isto os
  // jobs ficam órfãos em `fetching` até o sweep (incidente 2026-05-11).
  waitUntil(result.run());
  waitUntil(
    audit(extractAuditContextFromRequest(req, scope.orgId, scope.userId), {
      action: "CERTIDAO_BATCH_DISPATCH",
      result: "SUCCESS",
      resource: scope.proposal.id,
      resourceType: "Proposal",
      metadata: {
        batchId: parsed.data.batchId,
        jobCount: result.body.jobCount,
        totalCostCents: result.body.totalCostCents,
      },
    }).catch(() => {})
  );
  await prisma.proposalEvent
    .create({
      data: {
        proposalId: scope.proposal.id,
        eventName: "certidoes_dispatched",
        source: "system",
        payload: { batchId: parsed.data.batchId, jobCount: Number(result.body.jobCount ?? 0) },
      },
    })
    .catch(() => {});

  return NextResponse.json(result.body, { status: 202 });
}
