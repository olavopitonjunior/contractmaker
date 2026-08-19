import { Prisma } from "@prisma/client";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/db/prisma";
import {
  getEnvelope,
  listEnvelopeDocuments,
  listEnvelopeEvents,
  listEnvelopeRequirements,
  listEnvelopeSigners,
} from "./envelopes";
import { resolveClickSignCreds } from "./account";
import type { ClicksignCreds } from "./client";
import { persistSignedPdf } from "@/lib/clicksign/signed-pdf";
import { autoPromoteDealOnContractSigned } from "@/lib/contracts/auto-promote-signed";
import { notifyEnvelopeMilestone, resolveDealLink } from "@/lib/clicksign/notify-envelope";
import {
  completeInspectionOnEnvelopeClosed,
  revertInspectionOnEnvelopeCanceled,
} from "@/lib/locacao/inspection-signature";
import {
  onProposalEnvelopeClosed,
  onProposalEnvelopeRefused,
  onProposalEnvelopeCanceled,
} from "@/lib/proposals/webhook-hooks";

/**
 * Reconcilia o estado de UM envelope com a ClickSign v3 — fonte canônica de
 * quem assinou é `/events`. Compartilhado pelas rotas de sync de contrato e
 * de deal (documento avulso); cada rota carrega+guarda o envelope e delega.
 *
 * Idempotente: só grava quando o estado remoto difere do local. Em close,
 * baixa o PDF assinado e (se for contrato) auto-promove o stage do deal.
 */
export type EnvelopeWithSigners = Prisma.EnvelopeGetPayload<{
  include: { signers: true };
}>;

export interface SyncResult {
  ok: true;
  signersUpdated: number;
  envelopeUpdated: boolean;
  dealStagePromoted: boolean;
  remoteStatus: string | undefined;
  debug?: Record<string, unknown>;
}

export async function syncEnvelopeState(
  envelope: EnvelopeWithSigners,
  opts: { actorVia: string; debug?: boolean }
): Promise<SyncResult> {
  if (!envelope.clicksignId) {
    throw new EnvelopeNotSyncableError();
  }

  const creds = await resolveClickSignCreds(envelope.orgId);
  if (!creds) {
    throw new EnvelopeNotSyncableError(
      "Conta ClickSign não configurada para esta imobiliária."
    );
  }

  const [envResp, signersResp, requirementsResp, eventsResp, documentsResp] =
    await Promise.all([
      getEnvelope(envelope.clicksignId, creds),
      listEnvelopeSigners(envelope.clicksignId, creds),
      listEnvelopeRequirements(envelope.clicksignId, creds),
      listEnvelopeEvents(envelope.clicksignId, creds).catch(() => null),
      listEnvelopeDocuments(envelope.clicksignId, creds).catch(() => null),
    ]);

  const remoteStatus = (
    envResp as { data?: { attributes?: { status?: string } } }
  ).data?.attributes?.status;

  const stateBySigner = aggregateEventsBySigner(eventsResp);
  const stateByEmail = aggregateEventsByEmail(eventsResp);

  let signersUpdated = 0;
  const bouncedSignerIds: string[] = [];
  let refusedNewly = false;
  // sourceKind do signatário que o feed /events mostra como recusado — hint pro
  // onProposalEnvelopeRefused desambiguar a via ÚNICA (proprietário vs
  // proponente). Lido do `local` (o sourceKind é estático) contra o sinal
  // fresco do remote: sem query extra e sem a corrida da leitura pós-sync.
  let refusedSourceKind: string | null = null;
  // Houve recusa no remoto, RECÉM-descoberta ou já conhecida. Distinto de
  // `refusedNewly` (que gateia sino/evento e só vale na primeira vez) porque
  // aqui a pergunta é outra: "este envelope morreu de recusa ou de
  // cancelamento?". A ClickSign marca o envelope como `canceled` NOS DOIS
  // casos, então o status remoto sozinho não responde — quem responde é a
  // existência de um signatário com `refusedAt`.
  let refusedRemotely = false;
  // Evidência LOCAL da mesma pergunta: um webhook de recusa que chegou antes já
  // gravou o signatário. Vale mesmo quando o feed remoto está indisponível.
  const refusedLocally = envelope.signers.some(
    (s) => s.status === "refused" || s.refusedAt
  );
  // O feed `/events` é a ÚNICA fonte de recusa e é buscado best-effort
  // (`.catch(() => null)`). Sem ele não dá pra afirmar "ninguém recusou" — só
  // "não consegui verificar", que é afirmação diferente. Sem esta distinção,
  // uma falha de rede transformaria recusa em cancelamento silencioso e a
  // perderia PARA SEMPRE: o envelope viraria `canceled` local e sairia do sweep
  // do cron, que só varre `running`.
  const refusalEvidenceUnavailable = eventsResp === null && !refusedLocally;
  for (const local of envelope.signers) {
    const byKey = local.clicksignId
      ? stateBySigner.get(local.clicksignId)
      : null;
    // `email` é nullable (signatário só-WhatsApp). Sem e-mail, só a `key` casa —
    // que é o caminho correto de qualquer forma.
    const byEmail = local.email
      ? stateByEmail.get(local.email.toLowerCase())
      : null;
    const remote = byKey ?? byEmail;
    if (!remote) continue;

    const updates: Prisma.EnvelopeSignerUpdateInput = {};

    if (remote.refusedAt) {
      refusedSourceKind = local.sourceKind;
      refusedRemotely = true;
      if (local.status !== "refused") {
        updates.status = "refused";
        refusedNewly = true;
      }
      if (!local.refusedAt || +remote.refusedAt !== +local.refusedAt) {
        updates.refusedAt = remote.refusedAt;
      }
    } else if (remote.signedAt) {
      if (local.status !== "signed") updates.status = "signed";
      if (!local.signedAt || +remote.signedAt !== +local.signedAt) {
        updates.signedAt = remote.signedAt;
      }
      if (
        remote.viewedAt &&
        (!local.viewedAt || +remote.viewedAt !== +local.viewedAt)
      ) {
        updates.viewedAt = remote.viewedAt;
      }
    } else if (remote.viewedAt) {
      if (local.status !== "signed" && local.status !== "viewed") {
        updates.status = "viewed";
      }
      if (!local.viewedAt || +remote.viewedAt !== +local.viewedAt) {
        updates.viewedAt = remote.viewedAt;
      }
    } else if (remote.bounceAt) {
      // E-mail não entregue e o signatário ainda não avançou (sem
      // view/sign/refusal). Marca `email_failed` pra UI destacar em vermelho
      // com CTA de corrigir o e-mail. Prioridade mais baixa: qualquer avanço
      // real acima sobrepõe.
      if (
        local.status !== "signed" &&
        local.status !== "viewed" &&
        local.status !== "refused" &&
        local.status !== "email_failed"
      ) {
        updates.status = "email_failed";
        bouncedSignerIds.push(local.id);
      }
    }

    if (Object.keys(updates).length > 0) {
      await prisma.envelopeSigner.update({
        where: { id: local.id },
        data: updates,
      });
      signersUpdated += 1;
    }
  }

  // Marcos detectados só via reconciliação (webhook perdido). O helper ignora
  // envelope de proposta e dedupa (batchId) com o caminho do webhook.
  //  - bounce: um sino POR signatário (dedupeSuffix=signerId), senão o 2º seria
  //    engolido pelo dedupe por envelope;
  //  - recusa: um sino por envelope (simetria com o caminho signed do sync).
  if (bouncedSignerIds.length > 0 || refusedNewly) {
    const linkUrl = await resolveDealLink(envelope.dealId); // uma vez por envelope
    // Pro bounce de PROPOSTA: resolve o DONO uma vez — sem isto a delegação
    // faria 1 query de Proposal por signatário bounced.
    const proposalUserId =
      envelope.source === "proposal" && envelope.proposalId && bouncedSignerIds.length > 0
        ? (
            await prisma.proposal
              .findUnique({
                where: { id: envelope.proposalId },
                select: { userId: true },
              })
              // Best-effort: falha aqui só custa o sino — NUNCA aborta o sync
              // (o resto da reconciliação, incl. close/PDF, tem que rodar).
              .catch(() => null)
          )?.userId ?? null
        : null;
    const common = {
      envelopeId: envelope.id,
      orgId: envelope.orgId,
      source: envelope.source,
      dealId: envelope.dealId,
      proposalId: envelope.proposalId,
      proposalUserId,
      linkUrl,
    };
    await Promise.all([
      ...bouncedSignerIds.map((signerId) =>
        notifyEnvelopeMilestone({ ...common, kind: "email_failed", dedupeSuffix: signerId })
      ),
      ...(refusedNewly
        ? [notifyEnvelopeMilestone({ ...common, kind: "refused" })]
        : []),
    ]);
  }

  let envelopeUpdated = false;
  let dealStagePromoted = false;
  if (remoteStatus === "closed" && envelope.status !== "closed") {
    await prisma.envelope.update({
      where: { id: envelope.id },
      data: { status: "closed", closedAt: new Date() },
    });
    const signedUrl = await resolveSignedUrl(
      envelope.clicksignId,
      envResp,
      creds,
      envelope.documentClicksignId
    );
    if (signedUrl) waitUntil(downloadSignedPdf(envelope.id, signedUrl));
    envelopeUpdated = true;
    const promote = await autoPromoteDealOnContractSigned(envelope.id);
    dealStagePromoted = promote.promoted;
    await completeInspectionOnEnvelopeClosed(envelope.id);
    // Fecho via reconciliação (webhook perdido) também emite o sino de assinado.
    // batchId `${envelopeId}:signed` dedupa com o do webhook — nunca 2 sinos.
    await notifyEnvelopeMilestone({
      envelopeId: envelope.id,
      orgId: envelope.orgId,
      source: envelope.source,
      dealId: envelope.dealId,
      linkUrl: await resolveDealLink(envelope.dealId),
      kind: "signed",
    });
  } else if (
    remoteStatus === "canceled" &&
    envelope.status !== "canceled" &&
    !refusalEvidenceUnavailable
  ) {
    // Fechar o envelope local é IRREVERSÍVEL na prática: `canceled` sai do
    // sweep do cron (que só varre `running`), então esta é a última chance de
    // decidir recusa vs cancelamento. Sem o feed de eventos, não fechamos —
    // o envelope segue `running` e a próxima rodada do cron tenta de novo.
    await prisma.envelope.update({
      where: { id: envelope.id },
      data: { status: "canceled", canceledAt: new Date() },
    });
    await revertInspectionOnEnvelopeCanceled(envelope.id);
    envelopeUpdated = true;
  } else if (remoteStatus === "closed" && envelope.status === "closed") {
    const promote = await autoPromoteDealOnContractSigned(envelope.id);
    if (promote.promoted) {
      dealStagePromoted = true;
      envelopeUpdated = true;
    }
    await completeInspectionOnEnvelopeClosed(envelope.id);
  }

  if (
    remoteStatus === "closed" &&
    envelope.status === "closed" &&
    !envelope.signedDocumentUrl
  ) {
    const signedUrl = await resolveSignedUrl(
      envelope.clicksignId,
      envResp,
      creds,
      envelope.documentClicksignId
    );
    if (signedUrl) {
      await downloadSignedPdf(envelope.id, signedUrl);
      envelopeUpdated = true;
    }
  }

  // Propaga o desfecho pra máquina de status da PROPOSTA. Centralizado aqui (não
  // na rota de sync) pra que TODO caller do reconciler — botão Atualizar, cron
  // diário, sync de deal — dispare o avanço de status e os sinos. Sem isto, um
  // webhook `close` perdido reconciliado pelo cron fechava o envelope mas deixava
  // a proposta travada em "enviada", e como o envelope virava `closed` saía do
  // sweep seguinte (só `running`), derrotando a redundância. Os hooks são
  // idempotentes (advanceProposalStatus CAS + sino dedupado) e no-op fora de
  // proposta; best-effort pra nunca abortar o resto da reconciliação (contratos).
  if (envelope.source === "proposal" && envelope.proposalId) {
    try {
      if (remoteStatus === "closed" || remoteStatus === "finished") {
        await onProposalEnvelopeClosed(envelope.id);
      } else if (refusalEvidenceUnavailable && remoteStatus === "canceled") {
        // Envelope morto e sem como saber de quê. Não afirmamos nada: o
        // envelope continua `running` (acima) e o cron reconcilia depois.
        console.warn(
          `[envelope sync] ${envelope.id}: canceled sem feed de eventos — decisão adiada`
        );
      } else if (
        refusedNewly ||
        ((refusedRemotely || refusedLocally) && remoteStatus === "canceled")
      ) {
        // Recusa REAL — alguém se manifestou contra. `refusedNewly` cobre a
        // recusa recém-descoberta (inclusive com o envelope ainda `running`,
        // quando um de vários signatários recusa); a segunda perna cobre a
        // reconciliação de um envelope já morto cuja recusa já era conhecida.
        // Não basta `refusedRemotely` sozinho: num envelope `running` com
        // recusa antiga, isso redisparava a cada sync e, com dois recusantes de
        // sourceKind diferente, gravava um `status_transition_rejected` por
        // rodada, pra sempre.
        await onProposalEnvelopeRefused(envelope.id, { refusedSourceKind });
      } else if (remoteStatus === "canceled") {
        // Cancelado SEM recusa: ninguém recusou, o envelope foi cancelado (ou
        // expirou) na ClickSign. Antes caía no ramo de cima e a proposta virava
        // `recusada_proponente` — TERMINAL, com `refusedBy` gravado e sino de
        // "recusada" — afirmando no histórico uma recusa que não existiu.
        // O hook de cancelamento é o correto: devolve a 2ª via à parada de
        // decisão e, na 1ª via, não mexe (não sabemos se foi cancelamento ou
        // expiração, e o `appInitiated` é exclusivo do cancelamento
        // deliberado feito na nossa UI).
        await onProposalEnvelopeCanceled(envelope.id);
      }
    } catch (err) {
      console.error("[envelope sync] propagação de status da proposta falhou:", err);
    }
  }

  if (signersUpdated > 0 || envelopeUpdated) {
    await prisma.envelopeEvent.create({
      data: {
        envelopeId: envelope.id,
        eventName: "manual_sync",
        payload: {
          signersUpdated,
          envelopeUpdated,
          remoteStatus,
          actorVia: opts.actorVia,
        } as unknown as Prisma.InputJsonValue,
        source: "manual",
      },
    });
  }

  return {
    ok: true,
    signersUpdated,
    envelopeUpdated,
    dealStagePromoted,
    remoteStatus,
    ...(opts.debug && {
      debug: {
        envelopeRaw: envResp,
        signersRaw: signersResp,
        requirementsRaw: requirementsResp,
        eventsRaw: eventsResp,
        documentsRaw: documentsResp,
        aggregatedByEmail: Array.from(stateByEmail.entries()).map(
          ([email, state]) => ({
            email,
            signedAt: state.signedAt,
            viewedAt: state.viewedAt,
            refusedAt: state.refusedAt,
            bounceAt: state.bounceAt,
            bounceReason: state.bounceReason,
          })
        ),
        aggregatedByKey: Array.from(stateBySigner.entries()).map(
          ([key, state]) => ({
            key,
            signedAt: state.signedAt,
            viewedAt: state.viewedAt,
            refusedAt: state.refusedAt,
            bounceAt: state.bounceAt,
            bounceReason: state.bounceReason,
          })
        ),
        localSigners: envelope.signers.map((s) => ({
          clicksignId: s.clicksignId,
          name: s.name,
          email: s.email,
          status: s.status,
          signedAt: s.signedAt,
        })),
      },
    }),
  };
}

export class EnvelopeNotSyncableError extends Error {
  constructor(message = "Envelope ainda não tem ID na ClickSign") {
    super(message);
    this.name = "EnvelopeNotSyncableError";
  }
}

interface SignerEventState {
  signedAt: Date | null;
  viewedAt: Date | null;
  refusedAt: Date | null;
  /** Última falha de entrega de e-mail (evento `tracking_notification_error`
   *  com `notification.last_status === "bounce"`). A ClickSign expõe isso só
   *  no feed REST `/events` — NUNCA via webhook. */
  bounceAt: Date | null;
  bounceReason: string | null;
}

function aggregateEventsBySigner(resp: unknown): Map<string, SignerEventState> {
  return aggregateEventsBy(resp, (e) => e.signer?.key);
}

function aggregateEventsByEmail(resp: unknown): Map<string, SignerEventState> {
  return aggregateEventsBy(resp, (e) => e.signer?.email?.toLowerCase());
}

function aggregateEventsBy(
  resp: unknown,
  pickKey: (data: { signer?: { key?: string; email?: string } }) =>
    | string
    | null
    | undefined
): Map<string, SignerEventState> {
  const out = new Map<string, SignerEventState>();
  const data = (resp as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return out;

  for (const item of data as Array<{
    attributes?: {
      name?: string;
      created?: string;
      data?: {
        signer?: { key?: string; email?: string };
        notification?: {
          kind?: string;
          last_status?: string;
          last_bounce_type?: string;
          details?: string;
        };
      };
    };
  }>) {
    const name = item.attributes?.name;
    const eventData = item.attributes?.data;
    if (!name || !eventData) continue;
    const key = pickKey(eventData);
    const createdAt = parseDate(item.attributes?.created);
    if (!key || !createdAt) continue;

    const cur = out.get(key) ?? {
      signedAt: null,
      viewedAt: null,
      refusedAt: null,
      bounceAt: null,
      bounceReason: null,
    };

    if (name === "sign") {
      if (!cur.signedAt || +createdAt < +cur.signedAt) cur.signedAt = createdAt;
    } else if (name === "signature_started") {
      if (!cur.viewedAt || +createdAt < +cur.viewedAt) cur.viewedAt = createdAt;
    } else if (name === "refusal") {
      if (!cur.refusedAt || +createdAt < +cur.refusedAt) {
        cur.refusedAt = createdAt;
      }
    } else if (
      name === "tracking_notification_error" &&
      eventData.notification?.last_status === "bounce"
    ) {
      // E-mail voltou (endereço inválido/inexistente). Guarda a falha MAIS
      // RECENTE — se o operador corrigir o e-mail e reenviar, um `sign`/
      // `signature_started` posterior tem prioridade na reconciliação.
      if (!cur.bounceAt || +createdAt > +cur.bounceAt) {
        cur.bounceAt = createdAt;
        cur.bounceReason =
          eventData.notification?.details ??
          eventData.notification?.last_bounce_type ??
          "bounce";
      }
    }

    out.set(key, cur);
  }
  return out;
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * URL do PDF assinado do documento PRIMARY. `primaryDocumentId` importa quando o
 * envelope tem mais de um documento (contrato + laudo de vistoria): sem a
 * preferência explícita, "o primeiro da lista" pode ser o extra e viraria o
 * `signedDocumentUrl` do envelope. Os extras são baixados dentro de
 * `persistSignedPdf`.
 */
async function resolveSignedUrl(
  clicksignId: string,
  envResp: unknown,
  creds: ClicksignCreds,
  primaryDocumentId?: string | null
): Promise<string | null> {
  const fromIncluded = extractSignedUrl(envResp, primaryDocumentId);
  if (fromIncluded) return fromIncluded;

  try {
    const docs = await listEnvelopeDocuments(clicksignId, creds);
    const docsData = (docs as { data?: unknown }).data;
    if (!Array.isArray(docsData)) return null;
    const list = docsData as Array<{
      id?: string;
      links?: { files?: { signed?: string; original?: string } };
    }>;
    const ordered = primaryDocumentId
      ? [
          ...list.filter((d) => d.id === primaryDocumentId),
          ...list.filter((d) => d.id !== primaryDocumentId),
        ]
      : list;
    for (const doc of ordered) {
      const signedUrl = doc.links?.files?.signed;
      if (signedUrl) return signedUrl;
      const originalUrl = doc.links?.files?.original;
      if (originalUrl) return originalUrl;
    }
  } catch (err) {
    console.error("[envelope sync] falha resolveSignedUrl:", err);
  }
  return null;
}

function extractSignedUrl(
  resp: unknown,
  primaryDocumentId?: string | null
): string | null {
  const included = (resp as {
    included?: Array<{ id?: string; attributes?: Record<string, unknown> }>;
  }).included;
  if (!Array.isArray(included)) return null;
  const ordered = primaryDocumentId
    ? [
        ...included.filter((i) => i.id === primaryDocumentId),
        ...included.filter((i) => i.id !== primaryDocumentId),
      ]
    : included;
  for (const item of ordered) {
    const downloads = item.attributes?.downloads as
      | { signed_file_url?: string }
      | undefined;
    if (downloads?.signed_file_url) return downloads.signed_file_url;
  }
  return null;
}

async function downloadSignedPdf(envelopeId: string, url: string) {
  await persistSignedPdf(envelopeId, url, "[envelope sync]");
}
