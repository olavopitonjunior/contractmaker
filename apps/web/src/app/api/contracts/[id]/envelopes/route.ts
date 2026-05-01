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
  const authResult = await requireAuth(req);
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
