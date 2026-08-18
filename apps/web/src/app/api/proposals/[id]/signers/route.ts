import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { loadScopedProposal, proposalFeatureGuard } from "@/lib/proposals/route-helpers";
import { addSignerToEnvelope } from "@/lib/clicksign/signer-actions";
import { computeDedupeKey } from "@/lib/proposals/signer-dedupe";
import { checkProposalReadiness } from "@/lib/proposals/clicksign-readiness";
import {
  EDITABLE_STATUSES,
  AWAITING_DECISION_STATUSES,
  TERMINAL_STATUSES,
} from "@/lib/proposals/status-sets";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";

const addSchema = z
  .object({
    name: z.string().min(3, "Nome do signatário (mínimo 3 caracteres)."),
    email: z.string().email("E-mail inválido.").optional().or(z.literal("")),
    phone: z.string().optional(),
    documentation: z.string().optional(),
    cpf: z.string().optional(),
    role: z.enum(["proponente", "vendedor", "conjuge", "testemunha"]).default("proponente"),
    notifyChannel: z.enum(["email", "whatsapp"]).optional(),
    signingGroup: z.number().int().min(1).max(9).optional(),
    ownerId: z.string().optional(),
    percentual: z.number().min(0).max(100).optional(),
  })
  // Signatário sem contato não pode ser avisado e trava o envelope/preflight —
  // barrado na entrada (mesmo furo do "Vendedor com telefone 0").
  .refine((d) => Boolean(d.email?.trim()) || Boolean(d.phone?.trim()), {
    message: "Informe telefone ou e-mail do signatário.",
  });

/**
 * POST /api/proposals/[id]/signers — adiciona um signatário à proposta.
 *
 * DOIS regimes, por status (2026-08):
 *
 * 1. PRÉ-ENVIO (rascunho/aguardando_aprovacao/falha_envio) e PARADA DE DECISÃO
 *    (assinada_proponente): cria uma linha de `ProposalSigner` (plano). Na
 *    parada só entram vendedor/cônjuge/testemunha no grupo 2 — o grupo 1 já
 *    assinou. Dedupe pelo MESMO computeDedupeKey do envio (colisão → 409;
 *    `@@unique([proposalId, dedupeKey])` é o backstop → P2002 vira 409).
 *    Preflight: vendedor adicionado na parada precisa passar o
 *    checkProposalReadiness (422 no shape do blockToResponse — é ele que o
 *    envio da 2ª via vai validar); pendência leve vira `warnings` no 201.
 *
 * 2. ENVELOPE EM CURSO (enviada/entregue/visualizada/aguardando_vendedor):
 *    comportamento original — adiciona ao envelope ClickSign `running` (a
 *    ClickSign recusa trocar contato de signatário; o conserto é remover o
 *    errado e adicionar o certo). Preservado: é feature em produção
 *    (2026-08-04).
 *
 * Terminais → 409.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;
  const { auth, eff, proposal } = r;

  // Signatário novo = custo novo na ClickSign — mesma permissão dos botões da
  // parada de decisão (PROPOSAL_SEND).
  if (!can(eff, PERMISSION.PROPOSAL_SEND)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const feat = await proposalFeatureGuard(auth.org.id, proposal.kind);
  if (feat) return feat;

  if (TERMINAL_STATUSES.has(proposal.status)) {
    return NextResponse.json(
      { error: "Proposta encerrada — não aceita novos signatários." },
      { status: 409 }
    );
  }

  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados do signatário inválidos." },
      { status: 400 }
    );
  }
  const input = parsed.data;
  const cpf = (input.cpf ?? input.documentation)?.trim() || null;
  const email = input.email?.trim() || null;
  const phone = input.phone?.trim() || null;

  const preSend = EDITABLE_STATUSES.has(proposal.status);
  const decisionStop = AWAITING_DECISION_STATUSES.has(proposal.status);

  if (preSend || decisionStop) {
    if (decisionStop && input.role === "proponente") {
      return NextResponse.json(
        {
          error:
            "O proponente já assinou — na parada de decisão só entram vendedor/proprietário, cônjuge ou testemunha (2ª via).",
        },
        { status: 409 }
      );
    }
    const signingGroup =
      input.signingGroup ?? (input.role === "proponente" && !decisionStop ? 1 : 2);

    // Dedupe autoritativo ANTES do insert (mensagem melhor que P2002).
    const dedupeKey = computeDedupeKey({ name: input.name, email, cpf, phone });
    const existing = await prisma.proposalSigner.findFirst({
      where: { proposalId: proposal.id, dedupeKey },
      select: { id: true, name: true, signingGroup: true },
    });
    if (existing) {
      return NextResponse.json(
        {
          error: `Já existe um signatário com esta identidade ("${existing.name}").`,
        },
        { status: 409 }
      );
    }

    // Preflight no shape do blockToResponse — vendedor na parada será validado
    // de novo pelo envio da 2ª via; barrar aqui evita criar linha inutilizável.
    const issues = checkProposalReadiness([
      { name: input.name, email, cpf, phone, notifyChannel: input.notifyChannel ?? "email" },
    ]);
    if (decisionStop && input.role === "vendedor" && issues.length > 0) {
      const message = issues
        .map((i) => `${input.name}: ${i.reason}${i.hint ? ` (${i.hint})` : ""}`)
        .join(" ");
      return NextResponse.json(
        { error: "preflight", message, issues },
        { status: 422 }
      );
    }

    let signer;
    try {
      signer = await prisma.proposalSigner.create({
        data: {
          proposalId: proposal.id,
          role: input.role,
          name: input.name.trim(),
          email,
          cpf,
          phone,
          notifyChannel: input.notifyChannel ?? "email",
          signingGroup,
          included: true,
          dedupeKey,
          ...(input.ownerId ? { ownerId: input.ownerId } : {}),
          ...(input.percentual != null ? { percentual: input.percentual } : {}),
        },
      });
    } catch (err) {
      // Backstop do @@unique([proposalId, dedupeKey]) — corrida entre 2 aberturas.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return NextResponse.json(
          { error: "Signatário duplicado nesta proposta." },
          { status: 409 }
        );
      }
      throw err;
    }

    await prisma.proposalEvent
      .create({
        data: {
          proposalId: proposal.id,
          eventName: "signer_added",
          source: "user",
          payload: { role: input.role, name: input.name, signingGroup },
        },
      })
      .catch(() => {});
    await audit(
      extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId),
      {
        action: "PROPOSAL_UPDATE",
        result: "SUCCESS",
        resource: proposal.id,
        resourceType: "Proposal",
        metadata: { added: "plan_signer", role: input.role },
      }
    ).catch(() => {});

    return NextResponse.json(
      {
        ok: true,
        signer: { id: signer.id, role: signer.role, name: signer.name },
        // Pendências não-bloqueantes viram aviso (o preflight duro só vale pro
        // vendedor na parada — os demais têm tempo de corrigir antes do envio).
        warnings: issues.map((i) => `${i.reason}${i.hint ? ` (${i.hint})` : ""}`),
      },
      { status: 201 }
    );
  }

  // ── Regime 2: envelope EM CURSO (comportamento original preservado) ──
  const envelope = await prisma.envelope.findFirst({
    where: {
      proposalId: proposal.id,
      source: "proposal",
      status: { in: ["draft", "running"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!envelope) {
    return NextResponse.json(
      { error: "Esta proposta não tem envelope em curso. Envie a proposta primeiro." },
      { status: 409 }
    );
  }

  const result = await addSignerToEnvelope(envelope, {
    name: input.name,
    email: email ?? "",
    phone: phone ?? undefined,
    documentation: cpf ?? undefined,
    sourceKind: input.role === "vendedor" ? "vendedor" : "comprador",
    sourceIndex: 0,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  await audit(
    extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId),
    {
      action: "PROPOSAL_UPDATE",
      result: "SUCCESS",
      resource: proposal.id,
      resourceType: "Proposal",
      metadata: { added: "signer", role: input.role, envelopeId: envelope.id },
    }
  ).catch(() => {});

  return NextResponse.json({ ok: true, signer: result.data }, { status: 201 });
}
