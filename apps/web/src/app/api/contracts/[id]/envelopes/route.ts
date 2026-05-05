import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  sendEnvelopeForContract,
  EnvelopeBudgetError,
  MissingEmailsError,
} from "@/lib/clicksign/executor";
import { ClicksignError } from "@/lib/clicksign/client";
import { buildEnvelopeSendPreview } from "@/lib/clicksign/preview";
import { requireApproval, approvalResponse } from "@/lib/api/intents";

export const runtime = "nodejs";
export const maxDuration = 60;

const sendSchema = z.object({
  authMethod: z.enum(["email", "whatsapp", "selfie", "icp_brasil"]).optional(),
  envelopeName: z.string().min(1).max(200).optional(),
  deadlineAt: z.string().datetime().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const contract = await prisma.contract.findFirst({
    where: { id: params.id, deal: { pipeline: { orgId: ctx.orgId } } },
    select: { id: true },
  });
  if (!contract) {
    return NextResponse.json(
      { error: "Contrato não encontrado" },
      { status: 404 }
    );
  }

  const envelopes = await prisma.envelope.findMany({
    where: { contractId: params.id },
    include: {
      signers: { orderBy: [{ sourceKind: "asc" }, { sourceIndex: "asc" }] },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ envelopes });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
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

  const contract = await prisma.contract.findFirst({
    where: { id: params.id, deal: { pipeline: { orgId: ctx.orgId } } },
    select: { id: true, status: true },
  });
  if (!contract) {
    return NextResponse.json(
      { error: "Contrato não encontrado" },
      { status: 404 }
    );
  }
  if (contract.status !== "aprovado") {
    return NextResponse.json(
      { error: "Contrato precisa estar aprovado antes de enviar para assinatura" },
      { status: 400 }
    );
  }

  // Bearer → cria intent. Session → executa direto.
  if (ctx.via === "bearer") {
    const preview = await buildEnvelopeSendPreview({
      contractId: params.id,
      orgId: ctx.orgId,
      authMethod: parsed.data.authMethod,
      envelopeName: parsed.data.envelopeName,
      deadlineAt: parsed.data.deadlineAt ?? null,
    });
    if ("error" in preview) {
      return NextResponse.json(
        { error: preview.error },
        { status: preview.status }
      );
    }

    const idempotencyKey = req.headers.get("x-idempotency-key");
    const result = await requireApproval<unknown>({
      ctx: {
        via: ctx.via,
        userId: ctx.userId,
        orgId: ctx.orgId,
        actor: ctx.actor,
      },
      action: "ENVELOPE_SEND",
      payload: {
        contractId: params.id,
        authMethod: parsed.data.authMethod,
        envelopeName: parsed.data.envelopeName,
        deadlineAt: parsed.data.deadlineAt,
      },
      preview: {
        summary: preview.summary,
        details: preview.details as unknown as Record<string, unknown>,
      },
      req,
      idempotencyKey,
      run: async () => {
        try {
          const envelope = await sendEnvelopeForContract({
            contractId: params.id,
            authMethod: parsed.data.authMethod,
            envelopeName: parsed.data.envelopeName,
            deadlineAt: parsed.data.deadlineAt
              ? new Date(parsed.data.deadlineAt)
              : null,
          });
          return { status: 201, body: { envelope } };
        } catch (err) {
          return clicksignErrorToResponse(err);
        }
      },
    });
    return approvalResponse(result);
  }

  // Session: comportamento atual
  try {
    const envelope = await sendEnvelopeForContract({
      contractId: params.id,
      authMethod: parsed.data.authMethod,
      envelopeName: parsed.data.envelopeName,
      deadlineAt: parsed.data.deadlineAt
        ? new Date(parsed.data.deadlineAt)
        : null,
    });
    return NextResponse.json({ envelope }, { status: 201 });
  } catch (err) {
    if (err instanceof MissingEmailsError) {
      return NextResponse.json(
        {
          error: "Partes sem e-mail",
          missing: err.missing,
        },
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
    console.error("[envelopes POST] erro:", msg);
    return NextResponse.json(
      { error: msg || "Erro interno" },
      { status: 500 }
    );
  }
}

/** Converte erros do executor em RunResult pra reuso no run() de requireApproval. */
function clicksignErrorToResponse(err: unknown): {
  status: number;
  body: Record<string, unknown>;
} {
  if (err instanceof MissingEmailsError) {
    return {
      status: 422,
      body: { error: "Partes sem e-mail", missing: err.missing },
    };
  }
  if (err instanceof EnvelopeBudgetError) {
    return {
      status: 402,
      body: {
        error: "Orçamento mensal Clicksign excedido",
        spentCents: err.spentCents,
        budgetCents: err.budgetCents,
        planCostCents: err.planCostCents,
      },
    };
  }
  if (err instanceof ClicksignError) {
    return {
      status: 502,
      body: { error: `Clicksign: ${err.message}`, status: err.status },
    };
  }
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[envelopes POST] erro:", msg);
  return { status: 500, body: { error: msg || "Erro interno" } };
}
