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
 *
 * `cause` diz DE ONDE nasceu o cancelamento, e é POSICIONAL OBRIGATÓRIO de
 * propósito: a versão anterior era `opts.appInitiated?` com default vazio, e a
 * omissão silenciosa era exatamente o bug — o webhook chamava sem opts e a 1ª
 * via cancelada FORA da plataforma ficava presa até expirar. Obrigatório, um
 * caller novo que não souber a causa tem de ESCREVER "unknown", e isso é uma
 * decisão visível no diff, não um esquecimento.
 *
 * Via completa (1ª via), por causa:
 *  - "app": o corretor cancelou DELIBERADAMENTE na nossa UI (DELETE do
 *    envelope) pra corrigir algo e reenviar → CAS pra `falha_envio`, SEM sino
 *    (seria eco da ação dele). `falha_envio` é o balde já existente de "envio
 *    não vingou, reenvie": está em `EDITABLE_STATUSES` e no claim de
 *    `executeProposalSend`, então devolve edição e reenvio sem alargar nenhum
 *    dos dois conjuntos.
 *  - "external_cancel": alguém cancelou direto na ClickSign → MESMO CAS, e COM
 *    sino: o fato nasceu fora da vista do corretor; sem o aviso ele seguia
 *    achando "aguardando assinatura" (era a limitação registrada no changelog
 *    de 2026-08-19, agora fechada por decisão de produto).
 *  - "deadline": prazo venceu → NADA. O cron de expire é o DONO da expiração
 *    (marca `expirada` + sino próprio). Liberar aqui tiraria a proposta de
 *    EXPIRABLE_STATUSES e ela nunca mais seria marcada expirada.
 *  - "unknown": sem evidência não se afirma nada (padrão da reconciliação) —
 *    comportamento idêntico ao anterior, o cron de expire trata.
 *
 * A aresta `enviada|entregue|visualizada → falha_envio` também é exclusiva
 * daqui (ALLOWED_FROM.falha_envio só admite `enviada`, para o release de claim
 * órfão), então segue o mesmo padrão de CAS local do caso reduzida.
 */
export type ProposalCancelCause = "app" | "external_cancel" | "deadline" | "unknown";

export async function onProposalEnvelopeCanceled(
  envelopeId: string,
  cause: ProposalCancelCause
): Promise<void> {
  const env = await prisma.envelope.findUnique({
    where: { id: envelopeId },
    select: { source: true, proposalId: true, via: true, orgId: true, clicksignId: true },
  });
  if (env?.source !== "proposal" || !env.proposalId) return;
  const proposalId = env.proposalId;

  if (env.via !== "reduzida") {
    // Só cancelamento CONFIRMADO libera — ver a tabela de causas no docblock.
    if (cause !== "app" && cause !== "external_cancel") return;
    const released = await prisma.proposal.updateMany({
      where: {
        id: proposalId,
        status: { in: ["enviada", "entregue", "visualizada"] },
      },
      data: { status: "falha_envio" },
    });
    // Fora da 1ª via em curso (parada de decisão, 2ª via, terminal) não há o
    // que liberar: `assinada_proponente`/`aguardando_vendedor` já têm reenvio
    // próprio (SEND_VENDEDOR_STATUSES) e terminal é registro histórico.
    if (released.count === 0) return;
    await prisma.proposalEvent
      .create({
        data: {
          proposalId,
          eventName: "primeira_via_canceled",
          // O badge "Envio cancelado" e o chip de filtro discriminam SÓ pelo
          // eventName — a causa entra no source/payload pra forense.
          source: cause === "app" ? "api" : "clicksign",
          payload: {
            envelopeId,
            clicksignId: env.clicksignId,
            to: "falha_envio",
            cause,
          } as Prisma.InputJsonValue,
        },
      })
      .catch(() => {});

    // Sino SÓ no cancelamento externo: o fato nasceu na ClickSign, fora da
    // vista do corretor — sem o aviso ele seguia achando "aguardando
    // assinatura". `cause === "app"` continua mudo (seria eco da ação dele na
    // nossa UI). Emitido depois do CAS e só quando ele moveu: replay de
    // webhook vê count 0 e nem chega aqui.
    if (cause !== "external_cancel") return;
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
        kind: "send_canceled",
        // Por ENVELOPE, não por proposta: reenviar e ter o NOVO envelope
        // cancelado de fora é fato novo e merece sino novo; replay do mesmo
        // envelope dedupa.
        dedupeSuffix: envelopeId,
      })
    );
    return;
  }

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
        source: cause === "app" ? "api" : "clicksign",
        payload: { envelopeId, clicksignId: env.clicksignId } as Prisma.InputJsonValue,
      },
    })
    .catch(() => {});

  // Sino só quando o fato veio de FORA. Cancelamento feito aqui dentro pelo
  // próprio corretor não vira notificação: seria eco da ação dele, e o texto
  // ("cancelada ou expirou na ClickSign") descreveria um evento externo que
  // não houve. A devolução à parada de decisão acontece igual em todos os
  // casos — e o texto cobre external_cancel, deadline E unknown por igual.
  if (cause === "app") return;

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
