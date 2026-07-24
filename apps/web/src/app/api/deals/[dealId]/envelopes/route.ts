import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  sendEnvelopeForAttachment,
  EnvelopeBudgetError,
  MissingEmailsError,
} from "@/lib/clicksign/executor";
import { ClicksignError } from "@/lib/clicksign/client";
import {
  ClickSignNotConfiguredError,
  AuthMethodNotAllowedError,
} from "@/lib/clicksign/account";
import type { ClicksignRole } from "@/lib/clicksign/roles";

export const runtime = "nodejs";
export const maxDuration = 60;

const signerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  documentation: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  sourceKind: z.string().optional(),
  sourceIndex: z.number().int().nonnegative().optional(),
  // Qualificação ("Assina como") escolhida no dialog.
  role: z.string().optional(),
  // Grupo de ordem de assinatura (ClickSign v3). Omitido = paralelo.
  group: z.number().int().min(1).optional().nullable(),
});

const sendSchema = z.object({
  attachmentId: z.string().min(1),
  authMethod: z.enum(["email", "whatsapp", "selfie", "icp_brasil"]).optional(),
  envelopeName: z.string().min(1).max(200).optional(),
  deadlineAt: z.string().datetime().optional(),
  signers: z.array(signerSchema).min(1),
});

/**
 * GET /api/deals/:dealId/envelopes — lista unificada (Contract + Attachment).
 * Aba Assinaturas usa pra mostrar todos os envelopes do deal numa única visão.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const authResult = await requireAuth(req, { scope: "signatures:r" });
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const deal = await prisma.deal.findFirst({
    where: { id: params.dealId, pipeline: { orgId: ctx.orgId } },
    select: { id: true },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal não encontrado" }, { status: 404 });
  }

  const envelopes = await prisma.envelope.findMany({
    where: { dealId: params.dealId },
    include: {
      signers: { orderBy: [{ sourceKind: "asc" }, { sourceIndex: "asc" }] },
      contract: { select: { id: true, version: true } },
      attachment: { select: { id: true, filename: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Adiciona um label legível pra UI evitar resolver no client.
  const enriched = envelopes.map((e) => ({
    ...e,
    subjectLabel: e.contract
      ? `Contrato v${e.contract.version}`
      : e.attachment?.filename || e.name,
  }));

  return NextResponse.json({ envelopes: enriched });
}

/**
 * POST /api/deals/:dealId/envelopes — envia um DealAttachment direto pra
 * ClickSign. Não exige Contract aprovado: caso de uso é doc avulso da pasta
 * (aditivos, distratos, procurações, recibos).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const authResult = await requireAuth(req, { scope: "signatures:rw" });
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const body = await req.json().catch(() => ({}));
  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Garante que o attachment realmente pertence ao deal — bloqueia tentativas
  // de mandar attachment de outro deal/org via id forjado.
  const attachment = await prisma.dealAttachment.findUnique({
    where: { id: parsed.data.attachmentId },
    include: {
      deal: { include: { pipeline: { select: { orgId: true } } } },
    },
  });
  if (!attachment || attachment.dealId !== params.dealId) {
    return NextResponse.json(
      { error: "Documento não encontrado neste negócio" },
      { status: 404 }
    );
  }
  if (attachment.deal.pipeline.orgId !== ctx.orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const envelope = await sendEnvelopeForAttachment({
      attachmentId: parsed.data.attachmentId,
      authMethod: parsed.data.authMethod,
      envelopeName: parsed.data.envelopeName,
      deadlineAt: parsed.data.deadlineAt
        ? new Date(parsed.data.deadlineAt)
        : null,
      signers: parsed.data.signers.map((s) => ({
        name: s.name,
        email: s.email,
        documentation: s.documentation ?? null,
        phone: s.phone ?? null,
        sourceKind: s.sourceKind,
        sourceIndex: s.sourceIndex,
        role: s.role as ClicksignRole | undefined,
        group: s.group ?? null,
      })),
    });
    return NextResponse.json({ envelope }, { status: 201 });
  } catch (err) {
    if (err instanceof ClickSignNotConfiguredError) {
      return NextResponse.json(
        { error: err.message, code: "CLICKSIGN_NOT_CONFIGURED" },
        { status: 409 }
      );
    }
    if (err instanceof AuthMethodNotAllowedError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    if (err instanceof MissingEmailsError) {
      return NextResponse.json(
        { error: "Partes sem e-mail", missing: err.missing },
        { status: 422 }
      );
    }
    if (err instanceof EnvelopeBudgetError) {
      return NextResponse.json(
        {
          error: "Orçamento mensal Clicksign excedido",
          spentCents: err.spentCents,
          budgetCents: err.budgetCents,
          planCostCents: err.planCostCents,
        },
        { status: 402 }
      );
    }
    if (err instanceof ClicksignError) {
      return NextResponse.json(
        { error: `Clicksign: ${err.message}`, status: err.status },
        { status: 502 }
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[deals envelopes POST] erro:", msg);
    return NextResponse.json(
      { error: msg || "Erro interno" },
      { status: 500 }
    );
  }
}
