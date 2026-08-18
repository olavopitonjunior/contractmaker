import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { loadScopedProposal, proposalFeatureGuard } from "@/lib/proposals/route-helpers";
import { addSignerToEnvelope } from "@/lib/clicksign/signer-actions";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";

const addSchema = z
  .object({
    name: z.string().min(1),
    email: z.string().optional(),
    phone: z.string().optional(),
    documentation: z.string().optional(),
    role: z.enum(["proponente", "vendedor", "conjuge", "testemunha"]).default("proponente"),
  })
  // Signatário sem contato não pode ser avisado e trava o envelope — é o mesmo
  // furo que gerou o "Vendedor" com telefone "0". Aqui é barrado na entrada.
  .refine((d) => Boolean(d.email?.trim()) || Boolean(d.phone?.trim()), {
    message: "Informe telefone ou e-mail do signatário.",
  });

/**
 * POST /api/proposals/[id]/signers — adiciona signatário ao envelope EM CURSO
 * da proposta.
 *
 * Por que existe: a ClickSign recusa trocar o contato de um signatário depois
 * que o envelope sai (medido em 2026-08-04: 404 no PATCH em envelope
 * `running`). Sem esta rota, contato errado só tinha um remédio — cancelar a
 * proposta e refazer, destruindo o envelope e cobrando tudo de novo. Com ela o
 * conserto é remover o errado (`DELETE .../signers/[signerId]`) e adicionar o
 * certo, que é o que `addSignerToEnvelope` já sabia fazer em `running` para
 * contrato e negócio — só não estava exposto para proposta.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;
  const { auth, eff, proposal } = r;

  // Signatário novo = custo novo na ClickSign, então vale a permissão de ENVIO.
  if (!can(eff, PERMISSION.PROPOSAL_SEND)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const feat = await proposalFeatureGuard(auth.org.id, proposal.kind);
  if (feat) return feat;

  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados do signatário inválidos." },
      { status: 400 }
    );
  }
  const input = parsed.data;

  // O envelope da via completa é o que está em curso; a via do vendedor só
  // existe depois que o proponente assina.
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
    email: input.email?.trim() || "",
    phone: input.phone?.trim() || undefined,
    documentation: input.documentation?.trim() || undefined,
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
