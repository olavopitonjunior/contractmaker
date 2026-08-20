import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { loadScopedProposal } from "@/lib/proposals/route-helpers";
import { TERMINAL_STATUSES, LIVE_POLL_STATUSES } from "@/lib/proposals/status-sets";
import { clicksignRoleLabel } from "@/lib/clicksign/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/proposals/[id]/status — leitura RÁPIDA do estado atual pra polling em
 * tempo real (não chama a ClickSign; lê o DB que o webhook atualiza em ~1-3s).
 * Retorna o status da proposta + status por signatário (EnvelopeSigner, onde vive
 * o sign/view real) + dossiê/conversão + lembretes. Alvo do `useProposalPolling`.
 * Scope garantido pelo loadScopedProposal (criador ou responsável atribuído).
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;
  const { proposal } = r;

  const envelopes = await prisma.envelope.findMany({
    where: { proposalId: proposal.id, status: { notIn: ["failed"] } },
    select: {
      id: true,
      via: true,
      status: true,
      signers: {
        select: {
          id: true,
          name: true,
          role: true,
          notifyChannel: true,
          status: true,
          signingGroup: true,
          viewedAt: true,
          signedAt: true,
          refusedAt: true,
        },
        orderBy: { signingGroup: "asc" },
      },
    },
    orderBy: { via: "asc" },
  });

  const signers = envelopes.flatMap((e) =>
    e.signers.map((s) => ({
      id: s.id,
      via: e.via,
      name: s.name,
      // Papel EXIBÍVEL em PT: traduz a qualificação ClickSign (inglês: seller/
      // buyer/witness/party) — inclui testemunha, que o sourceKind colapsaria.
      role: clicksignRoleLabel(s.role),
      channel: s.notifyChannel,
      status: s.status,
      signingGroup: s.signingGroup,
      viewedAt: s.viewedAt?.toISOString() ?? null,
      signedAt: s.signedAt?.toISOString() ?? null,
      refusedAt: s.refusedAt?.toISOString() ?? null,
    }))
  );

  // "Ativo" = ainda há algo esperando (pra o hook saber quando parar de pollar).
  // Não basta ter envelope `running`: durante o handoff proponente→vendedor não
  // há envelope vivo por alguns segundos, e o poller não pode parar aí.
  // A PARADA DE DECISÃO (assinada_proponente) fica FORA: é durável (dias) e
  // pollar ali é carga eterna no Neon sem informação nova — quem muda o estado
  // é o próprio corretor, na tela (bug B do plano 2026-08-06).
  const active =
    !TERMINAL_STATUSES.has(proposal.status) &&
    (envelopes.some((e) => e.status === "running") ||
      LIVE_POLL_STATUSES.has(proposal.status));

  return NextResponse.json({
    status: proposal.status,
    // O cliente gateia o botão Excluir por status+sentAt (ver
    // isFalhaEnvioAlreadyDelivered). Sem o sentAt AQUI, o gate usava o prop do
    // servidor congelado na carga da página — e uma proposta que enviou e foi
    // cancelada em outra aba oferecia Excluir com a API respondendo 409, a
    // versão em miniatura do bug que este payload existe pra evitar.
    sentAt: proposal.sentAt?.toISOString() ?? null,
    dossierUrl: proposal.dossierUrl,
    convertedDealId: proposal.convertedDealId,
    lastReminderAt: proposal.lastReminderAt?.toISOString() ?? null,
    reminderCount: proposal.reminderCount,
    envelopes: envelopes.map((e) => ({ id: e.id, via: e.via, status: e.status })),
    signers,
    active,
    updatedAt: proposal.updatedAt.toISOString(),
  });
}
