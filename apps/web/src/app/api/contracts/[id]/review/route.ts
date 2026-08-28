import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { guardContractScope } from "@/lib/deals/route-helpers";
import { isContractReviewEnabled } from "@/lib/contract-review/guard";
import { isClaimable, type ReviewStatus } from "@/lib/contract-review/review-state";
import { reviewAdvanceUrl } from "@/lib/contract-review/enqueue";
import { requestOrigin } from "@/lib/ingestion/chain";

export const runtime = "nodejs";

/**
 * Revisão SOB DEMANDA de um contrato ("Revisar com IA" na tela do contrato).
 *
 * A revisão automática roda uma vez, na geração; depois de edições manuais no
 * Doc o operador pede outra por aqui. POST cria um run novo (ou reusa o que já
 * está na fila — clicar duas vezes não paga duas revisões) e dispara o
 * /advance pela mesma corrente interna do enqueue; GET devolve o run mais
 * recente para a UI acompanhar sem WebSocket.
 *
 * Comentários são upsert por dedupeKey: re-revisar não duplica o que já foi
 * apontado, e o que o operador resolveu permanece resolvido (mesma régua do
 * render linter).
 */

async function authorize(req: NextRequest, contractId: string) {
  const auth = await requireApiAuth(req, { scope: "contracts:rw" });
  if (isAuthFailure(auth)) return { response: authFailureResponse(auth) };

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: {
      id: true,
      status: true,
      deal: { select: { kind: true, pipeline: { select: { orgId: true } } } },
    },
  });
  if (!contract || contract.deal.pipeline.orgId !== auth.org.id) {
    return {
      response: NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 }),
    };
  }

  const denied = await guardContractScope({
    contractId,
    userId: auth.actor.effectiveUserId,
    orgId: auth.org.id,
    via: auth.ident.via,
  });
  if (denied) return { response: denied };

  return { auth, contract };
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await authorize(req, params.id);
  if ("response" in ctx) return ctx.response;

  const run = await prisma.contractReviewRun.findFirst({
    where: { contractId: params.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, error: true, updatedAt: true, createdAt: true },
  });
  return NextResponse.json({ run });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await authorize(req, params.id);
  if ("response" in ctx) return ctx.response;
  const { auth, contract } = ctx;

  if (contract.status === "aprovado") {
    return NextResponse.json(
      { error: "Contrato aprovado é imutável — a revisão não se aplica." },
      { status: 409 }
    );
  }

  const enabled = await isContractReviewEnabled(auth.org.id, contract.deal.kind);
  if (!enabled) {
    return NextResponse.json(
      { error: "A revisão pós-geração está desligada para esta imobiliária." },
      { status: 403 }
    );
  }

  // Idempotência de clique: run vivo (queued/reviewing não-stale) é reusado —
  // o claim atômico do executor já impede processamento duplo; aqui evitamos
  // só a FILA dupla.
  const now = new Date();
  const live = await prisma.contractReviewRun.findFirst({
    where: { contractId: params.id, status: { in: ["queued", "reviewing"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, startedAt: true },
  });
  if (
    live &&
    (live.status === "queued" ||
      !isClaimable({ status: live.status as ReviewStatus, startedAt: live.startedAt }, now))
  ) {
    waitUntil(chainAdvance(requestOrigin(req), live.id));
    return NextResponse.json({ runId: live.id, reused: true });
  }

  const run = await prisma.contractReviewRun.create({
    data: { contractId: params.id, orgId: auth.org.id },
    select: { id: true },
  });
  waitUntil(chainAdvance(requestOrigin(req), run.id));
  return NextResponse.json({ runId: run.id, reused: false });
}

/** Dispara o /advance pela porta interna (CRON_SECRET) — a rota de advance
 *  também aceita a sessão, mas a corrente não deve carregar cookie de usuário
 *  (mesmo racional de lib/ingestion/chain.ts). Sem secret, o sweeper assume. */
async function chainAdvance(origin: string, runId: string): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  try {
    await fetch(reviewAdvanceUrl(origin, runId), {
      method: "POST",
      headers: { "x-cron-secret": secret },
    });
  } catch (err) {
    console.warn(`[contract-review] disparo sob demanda do run ${runId} falhou (sweeper assume):`, err);
  }
}
