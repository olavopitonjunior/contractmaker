import { waitUntil } from "@vercel/functions";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSignatureSettings } from "@/lib/clicksign/account";
import { advanceProposalStatus } from "./status";
import { sendVendedorVia } from "./send-execute";
import { notifyProposalMilestone } from "./notify-proposal";

/**
 * Ponte webhook ClickSign → Proposal, para envelopes com `source="proposal"`.
 * No-op para envelopes de contrato/attachment. Chamado do webhook-process.ts,
 * espelhando `autoPromoteDealOnContractSigned`.
 *
 * Sinos (notify-proposal) SÓ quando `advanceProposalStatus` reporta
 * `moved:true` — evento tardio/replay numa proposta cancelada/convertida não
 * pode tocar sino falso nem consumir o batchId de um marco legítimo futuro.
 * Emissão via waitUntil: não atrasa a resposta do webhook.
 */

/** Fechamento (close/auto_close) de um envelope de proposta. */
export async function onProposalEnvelopeClosed(
  envelopeId: string
): Promise<void> {
  const env = await prisma.envelope.findUnique({
    where: { id: envelopeId },
    select: { source: true, proposalId: true, via: true },
  });
  if (env?.source !== "proposal" || !env.proposalId) return;
  const proposalId = env.proposalId;

  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: { orgId: true, userId: true },
  });
  if (!proposal) return;

  const notifyCompleted = () =>
    waitUntil(
      notifyProposalMilestone({
        proposalId,
        orgId: proposal.orgId,
        userId: proposal.userId,
        kind: "completed",
      })
    );

  if (env.via === "reduzida") {
    // Via do proprietário fechou → tudo assinado.
    const adv = await advanceProposalStatus(proposalId, "completa", {
      completedAt: new Date(),
    });
    if (adv.moved) notifyCompleted();
    return;
  }

  // via === "completa": os proponentes assinaram. O resultado do advance é
  // capturado: TUDO que segue (evento de parada, sino, encadeamento) só pode
  // acontecer em `moved:true` — webhook reentregue (replay) não pode re-tocar
  // sino nem re-agendar envio.
  const advAssinada = await advanceProposalStatus(proposalId, "assinada_proponente");

  // Guarda de migração: se ESTE envelope combinado já inclui o vendedor (fluxo
  // legado pré-encadeamento — comprador+vendedor num único envelope), ele já
  // assinou aqui (o envelope fechou). Encadear um 2º envelope re-convidaria e
  // cobraria o vendedor de novo (R$/signer) e travaria a proposta fora de
  // 'completa'. Como o envelope está fechado, todos os seus signers assinaram →
  // a presença de um signer do vendedor basta pra fechar a proposta aqui.
  // NB: filtra por `sourceKind` (domínio: "vendedor"), NÃO por `role` — este
  // guarda a qualificação ClickSign em inglês ("seller"), então role:"vendedor"
  // nunca casaria (dead code) e o double-charge continuaria.
  const vendedorNoEnvelope = await prisma.envelopeSigner.findFirst({
    where: { envelopeId, sourceKind: "vendedor" },
    select: { id: true },
  });
  if (vendedorNoEnvelope) {
    const adv = await advanceProposalStatus(proposalId, "completa", {
      completedAt: new Date(),
    });
    if (adv.moved) notifyCompleted();
    return;
  }

  // Há proprietário/vendedor pra assinar?
  const vendedores = await prisma.proposalSigner.count({
    where: { proposalId, included: true, role: "vendedor" },
  });
  if (vendedores === 0) {
    // Só proponentes → proposta completa.
    const adv = await advanceProposalStatus(proposalId, "completa", {
      completedAt: new Date(),
    });
    if (adv.moved) notifyCompleted();
    return;
  }

  // FLIP 2026-08 (decisão do dono): o handoff comprador→proprietário é uma
  // DECISÃO HUMANA. Default = PARAR em `assinada_proponente` (não fecha
  // completa, não encadeia, não toca o sino de completed) e avisar o corretor
  // ("sua vez"). Escape hatch por org: `proposalAutoChainVendedor` restaura o
  // encadeamento automático de antes.
  const settings = await getSignatureSettings(proposal.orgId);
  if (settings.proposalAutoChainVendedor) {
    // Encadeamento automático (comportamento pré-flip). O avanço pra
    // `aguardando_vendedor` acontece DENTRO do send (pós-sucesso) — aqui só
    // avisa e dispara. Falha do envio deixa a proposta na parada, com o botão
    // e o sino de falha; o cron reconcile cobre as que já avançaram.
    if (advAssinada.moved) {
      waitUntil(
        notifyProposalMilestone({
          proposalId,
          orgId: proposal.orgId,
          userId: proposal.userId,
          kind: "signed_proponente",
        })
      );
    }
    waitUntil(
      sendVendedorVia(proposalId, "webhook").catch((err) => {
        console.error("[proposals] sendVendedorVia falhou:", err);
      })
    );
    return;
  }

  // PARADA na decisão. Evento + sino só no 1º processamento (moved) — replay
  // de webhook não re-toca.
  if (advAssinada.moved) {
    await prisma.proposalEvent
      .create({
        data: {
          proposalId,
          eventName: "awaiting_owner_decision",
          source: "system",
          payload: { vendedores } as Prisma.InputJsonValue,
        },
      })
      .catch(() => {});
    waitUntil(
      notifyProposalMilestone({
        proposalId,
        orgId: proposal.orgId,
        userId: proposal.userId,
        kind: "awaiting_decision",
      })
    );
  }
}

/**
 * Cancelamento/expiração (cancel/deadline) de um envelope de proposta — o caso
 * que deixava proposta PRESA (bug D): a 2ª via expirava na ClickSign e a
 * proposta ficava em `aguardando_vendedor` pra sempre (e o reenvio estourava
 * P2002 na row `canceled`).
 *
 * Via reduzida → devolve a proposta à PARADA de decisão. A aresta
 * `aguardando_vendedor → assinada_proponente` é EXCLUSIVA deste hook — por isso
 * o CAS é local (updateMany) e ela NÃO entra em ALLOWED_FROM, senão qualquer
 * caller ganharia um "voltar status".
 * Via completa → nada aqui: o cron de expire trata a proposta como hoje.
 */
export async function onProposalEnvelopeCanceled(envelopeId: string): Promise<void> {
  const env = await prisma.envelope.findUnique({
    where: { id: envelopeId },
    select: { source: true, proposalId: true, via: true, orgId: true, clicksignId: true },
  });
  if (env?.source !== "proposal" || !env.proposalId) return;
  if (env.via !== "reduzida") return;
  const proposalId = env.proposalId;

  const res = await prisma.proposal.updateMany({
    where: { id: proposalId, status: "aguardando_vendedor" },
    data: { status: "assinada_proponente" },
  });
  if (res.count === 0) return; // replay ou proposta já seguiu — no-op

  await prisma.proposalEvent
    .create({
      data: {
        proposalId,
        eventName: "vendedor_via_canceled",
        source: "clicksign",
        payload: { envelopeId, clicksignId: env.clicksignId } as Prisma.InputJsonValue,
      },
    })
    .catch(() => {});

  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: { userId: true },
  });
  if (!proposal) return;
  waitUntil(
    notifyProposalMilestone({
      proposalId,
      orgId: env.orgId,
      userId: proposal.userId,
      kind: "vendedor_send_failed",
      dedupeSuffix: `canceled:${envelopeId}`,
      bodyOverride:
        "A via do proprietário foi cancelada ou expirou na ClickSign. A proposta voltou para a sua decisão — reenvie ou conclua sem enviar.",
    })
  );
}

/**
 * Recusa de um envelope de proposta.
 *
 * `refusedSourceKind` é o `EnvelopeSigner.sourceKind` do signatário que
 * RECUSOU (resolvido pelo webhook-process): na via ÚNICA proponente e
 * proprietário assinam o mesmo envelope, então a via sozinha não diz quem
 * recusou — sem o hint, a recusa do proprietário (o desfecho QUENTE: há um
 * comprador comprometido) era atribuída ao proponente.
 */
export async function onProposalEnvelopeRefused(
  envelopeId: string,
  opts: { refusedSourceKind?: string | null } = {}
): Promise<void> {
  const env = await prisma.envelope.findUnique({
    where: { id: envelopeId },
    select: { source: true, proposalId: true, via: true, orgId: true },
  });
  if (env?.source !== "proposal" || !env.proposalId) return;
  const proposalId = env.proposalId;

  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: { userId: true },
  });
  if (!proposal) return;

  // Quem recusou: via reduzida = sempre o proprietário; nas demais, o
  // sourceKind do signatário resolvido decide ("vendedor" = proprietário).
  // Sem hint (payload sem key/e-mail resolvível), assume proponente.
  const refusedBy =
    env.via === "reduzida" || opts.refusedSourceKind === "vendedor"
      ? ("vendedor" as const)
      : ("proponente" as const);
  const to = refusedBy === "vendedor" ? "recusada_vendedor" : "recusada_proponente";
  // `refusedBy` PERSISTIDO (campo já existia no schema e só viajava no sino) —
  // é o registro pedido pela decisão do dono (contraproposta fora de escopo,
  // mas quem recusou fica gravado).
  const adv = await advanceProposalStatus(proposalId, to, {
    refusedAt: new Date(),
    refusedBy,
  });
  if (adv.moved) {
    waitUntil(
      notifyProposalMilestone({
        proposalId,
        orgId: env.orgId,
        userId: proposal.userId,
        kind: "refused",
        refusedBy,
        // Suffix por via: recusas nas duas vias são sinos distintos.
        dedupeSuffix: env.via ?? undefined,
      })
    );
  }
}
