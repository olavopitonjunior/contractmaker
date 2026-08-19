import { Prisma } from "@prisma/client";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/db/prisma";
import { getSignatureSettings } from "@/lib/clicksign/account";
import { advanceProposalStatus } from "./status";
import { sendVendedorVia } from "./send-execute";
import { buildAcceptanceProof, buildAcceptanceMessage } from "./acceptance-proof";
import {
  syncAcceptanceRecord,
  type AcceptanceRecordSyncResult,
} from "./acceptance-record-sync";
import { notifyProposalMilestone } from "./notify-proposal";
import { proposalPublicLink } from "./public-link";

/**
 * Ponte webhook ClickSign → Proposal para o Aceite via WhatsApp
 * (`acceptance_term_*`). Diferente do envelope, o Aceite não tem `document.key`;
 * é resolvido pelo `acceptance_term` id gravado em `Proposal.acceptanceClicksignId`.
 *
 * O ciclo de vida da proposta é dirigido pelo termo do PROPONENTE (o vinculante,
 * cujo id fica em `acceptanceClicksignId`). Aceites suplementares (proprietário
 * como terceiro) são registrados mas não redefinem o desfecho — o schema atual
 * não rastreia aceite por-signatário.
 */

/**
 * Terminais NEGATIVOS — proposta morta. Sinos de acompanhamento (entrega,
 * aceite de parte) não tocam a partir daqui: um evento tardio numa proposta
 * cancelada/recusada seria ruído. `completa`/`convertida` NÃO entram: no Aceite
 * multi-termo os termos são paralelos, então entrega e aceite do proprietário
 * depois da proposta fechar são a ordem normal, não anomalia.
 */
const DEAD_FOR_TRACKING = new Set([
  "cancelada",
  "expirada",
  "recusada_proponente",
  "recusada_vendedor",
]);

/**
 * Termo do PROPRIETÁRIO (2ª via do Aceite) morreu na ClickSign (expired/
 * canceled): devolve a proposta à parada de decisão — espelho do
 * `onProposalEnvelopeCanceled` do caminho de envelope. Sem isto a proposta
 * ficava presa em `aguardando_vendedor` pra sempre, sem sino e sem reenvio
 * (a linha já foi marcada expired/canceled acima, o que torna o termo
 * reemissível pelo sendVendedorAceiteLocked).
 */
async function returnVendedorAceiteToDecision(
  proposal: { id: string; orgId: string; userId: string },
  signerId: string,
  phase: string
): Promise<void> {
  const res = await prisma.proposal.updateMany({
    where: { id: proposal.id, status: "aguardando_vendedor" },
    data: { status: "assinada_proponente" },
  });
  if (res.count === 0) return; // replay ou proposta já seguiu — no-op

  await prisma.proposalEvent
    .create({
      data: {
        proposalId: proposal.id,
        eventName: "vendedor_via_canceled",
        source: "clicksign",
        payload: { instrument: "aceite", signerId, phase } as Prisma.InputJsonValue,
      },
    })
    .catch(() => {});

  waitUntil(
    notifyProposalMilestone({
      proposalId: proposal.id,
      orgId: proposal.orgId,
      userId: proposal.userId,
      kind: "vendedor_send_failed",
      dedupeSuffix: `aceite-${phase}:${signerId}`,
      bodyOverride:
        "O termo do proprietário expirou ou foi cancelado na ClickSign. A proposta voltou para a sua decisão — reenvie ou conclua sem enviar.",
    })
  );
}

interface AcceptanceEventInput {
  acceptanceId: string;
  phase: string; // sent | completed | refused | expired | canceled | error | ...
  payload: unknown;
  orgId?: string;
}

export interface AcceptanceProcessResult {
  ok: true;
  handled: boolean;
  proposalId?: string;
  phase: string;
  unknownAcceptance?: boolean;
}

function factsFromPayload(payload: unknown): {
  signerName?: string;
  signerPhone?: string;
  sentAt?: string;
  completedAt?: string;
} {
  const p = payload as {
    // Shape REAL da ClickSign v3: o termo vem em `acceptance` no topo.
    acceptance?: {
      signer_name?: string;
      signer_phone?: string;
      sent_at?: string;
      completed_at?: string;
    };
    event?: {
      data?: {
        acceptance_term?: {
          signer_name?: string;
          signer_phone?: string;
          sent_at?: string;
          completed_at?: string;
        };
        signer_name?: string;
        signer_phone?: string;
      };
      occurred_at?: string;
    };
  };
  const acc = p.acceptance;
  const a = p.event?.data?.acceptance_term;
  return {
    signerName: acc?.signer_name ?? a?.signer_name ?? p.event?.data?.signer_name,
    signerPhone: acc?.signer_phone ?? a?.signer_phone ?? p.event?.data?.signer_phone,
    sentAt: acc?.sent_at ?? a?.sent_at,
    completedAt: acc?.completed_at ?? a?.completed_at ?? p.event?.occurred_at,
  };
}

export async function processProposalAcceptanceEvent(
  input: AcceptanceEventInput
): Promise<AcceptanceProcessResult> {
  const orgScope = input.orgId ? { orgId: input.orgId } : {};

  // Resolve por SIGNATÁRIO primeiro (cada ProposalSigner tem seu acceptance_term)
  // e cai pra Proposal.acceptanceClicksignId (compat). Saber QUEM aceitou é o que
  // permite (a) marcar o desfecho do signatário certo, (b) só completar quando o
  // PROPONENTE aceitar, (c) não descartar a recusa de um proprietário.
  const signer = await prisma.proposalSigner.findFirst({
    where: {
      acceptanceClicksignId: input.acceptanceId,
      ...(input.orgId ? { proposal: { orgId: input.orgId } } : {}),
    },
    select: { id: true, role: true, proposalId: true },
  });
  const proposal = signer
    ? await prisma.proposal.findUnique({
        where: { id: signer.proposalId },
        select: { id: true, orgId: true, userId: true, status: true, title: true, token: true, instrument: true, validUntil: true },
      })
    : await prisma.proposal.findFirst({
        where: { acceptanceClicksignId: input.acceptanceId, ...orgScope },
        select: { id: true, orgId: true, userId: true, status: true, title: true, token: true, instrument: true, validUntil: true },
      });
  if (!proposal) {
    return { ok: true, handled: false, phase: input.phase, unknownAcceptance: true };
  }

  // O signatário é o proponente quando resolvemos por linha e role="proponente",
  // OU quando caímos no fallback (Proposal.acceptanceClicksignId aponta pro
  // proponente por construção no envio).
  const isProponente = signer ? signer.role === "proponente" : true;

  // Registra SEMPRE o evento cru na timeline da proposta (durabilidade §9.6).
  await prisma.proposalEvent
    .create({
      data: {
        proposalId: proposal.id,
        eventName: `acceptance_term_${input.phase}`,
        source: "webhook",
        payload: input.payload as Prisma.InputJsonValue,
      },
    })
    .catch(() => {});

  const facts = factsFromPayload(input.payload);

  // Marca o desfecho NA LINHA do signatário (quando resolvido por linha).
  if (signer) {
    const perSigner: Record<string, { acceptanceStatus: string; acceptedAt?: Date; refusedAt?: Date }> = {
      completed: { acceptanceStatus: "completed", acceptedAt: new Date() },
      refused: { acceptanceStatus: "refused", refusedAt: new Date() },
      expired: { acceptanceStatus: "expired" },
      canceled: { acceptanceStatus: "canceled" },
    };
    const upd = perSigner[input.phase];
    if (upd) {
      await prisma.proposalSigner
        .update({ where: { id: signer.id }, data: upd })
        .catch(() => {});
    }
  }

  switch (input.phase) {
    case "sent": {
      // No Aceite a ClickSign confirma a ENTREGA — "Entregue" é real neste modo.
      await advanceProposalStatus(proposal.id, "entregue", { deliveredAt: new Date() });

      // Sino POR SIGNATÁRIO, não gateado em `adv.moved`: este case roda pro
      // termo do proponente E pro do proprietário, mas o status só se move na
      // primeira vez (a CAS rejeita a segunda). Gatear no `moved` faria a
      // entrega ao proprietário nunca avisar. Quem segura replay aqui é a
      // @@unique([type, batchId]) via dedupeSuffix — mesmo padrão de
      // `accepted_party`. Gate só em terminais NEGATIVOS: entrega tardia numa
      // proposta morta não toca sino.
      if (!DEAD_FOR_TRACKING.has(proposal.status)) {
        waitUntil(
          notifyProposalMilestone({
            proposalId: proposal.id,
            orgId: proposal.orgId,
            userId: proposal.userId,
            kind: "delivered",
            dedupeSuffix: signer?.id ?? "proponente",
          })
        );
      }
      break;
    }

    case "completed": {
      // Só o aceite do PROPONENTE completa a proposta. O aceite de um proprietário
      // (terceiro) é registrado na linha dele, mas não redefine o desfecho —
      // antes, com 1 aceite de qualquer um a proposta virava "completa".
      if (!isProponente) {
        // Paridade da 2ª rodada (2026-08): quando o aceite do VENDEDOR fecha o
        // conjunto (todos os vendedores completed) e a proposta está em
        // `aguardando_vendedor`, ela completa — espelho do close da via
        // reduzida no envelope.
        if (signer!.role === "vendedor" && proposal.status === "aguardando_vendedor") {
          const vendedorPendente = await prisma.proposalSigner.count({
            where: {
              proposalId: proposal.id,
              included: true,
              role: "vendedor",
              NOT: { acceptanceStatus: "completed" },
            },
          });
          if (vendedorPendente === 0) {
            const advCompletaVend = await advanceProposalStatus(proposal.id, "completa", {
              completedAt: new Date(),
            });
            if (advCompletaVend.moved) {
              waitUntil(
                notifyProposalMilestone({
                  proposalId: proposal.id,
                  orgId: proposal.orgId,
                  userId: proposal.userId,
                  kind: "completed",
                })
              );
            }
            return { ok: true, handled: true, proposalId: proposal.id, phase: input.phase };
          }
        }
        // Sino por-signatário: um proprietário aceitou o termo dele. Suffix
        // obrigatório — sem ele o aceite do 2º proprietário seria engolido
        // pelo unique (type, batchId). GATE: bloqueia SÓ terminais NEGATIVOS
        // (proposta morta) — aceite do proprietário DEPOIS de completa/
        // convertida é a ordem normal do Aceite multi-termo (termos paralelos)
        // e falha_envio segue viva/reenviável; nesses casos o sino toca.
        if (!DEAD_FOR_TRACKING.has(proposal.status)) {
          // Body condiciona ao momento: pós-completa/convertida, "aguardando
          // o proponente" seria falso — o aceite é confirmação de arquivo.
          const afterCompletion =
            proposal.status === "completa" || proposal.status === "convertida";
          waitUntil(
            notifyProposalMilestone({
              proposalId: proposal.id,
              orgId: proposal.orgId,
              userId: proposal.userId,
              kind: "accepted_party",
              dedupeSuffix: signer!.id,
              ...(afterCompletion
                ? {
                    bodyOverride:
                      "Um participante registrou o aceite do termo dele. A proposta já está completa — aceite arquivado no histórico.",
                  }
                : {}),
            })
          );
        } else {
          // Proposta morta (expirada/cancelada/recusada) recebendo um ACEITE de
          // terceiro: juridicamente relevante e antes invisível — o operador
          // precisa saber que existe um aceite órfão na ClickSign pra decidir
          // (reabrir negócio por fora, arquivar, responder ao interessado).
          await prisma.proposalEvent
            .create({
              data: {
                proposalId: proposal.id,
                eventName: "acceptance_orphan_after_terminal",
                source: "webhook",
                payload: {
                  signerId: signer!.id,
                  proposalStatus: proposal.status,
                } as Prisma.InputJsonValue,
              },
            })
            .catch(() => {});
          waitUntil(
            notifyProposalMilestone({
              proposalId: proposal.id,
              orgId: proposal.orgId,
              userId: proposal.userId,
              kind: "accepted_party",
              dedupeSuffix: `orphan:${signer!.id}`,
              bodyOverride:
                "Um participante aceitou o termo dele, mas a proposta já estava encerrada (expirada/cancelada/recusada). O aceite ficou registrado no histórico — revise se o negócio deve ser retomado.",
            })
          );
        }
        return { ok: true, handled: true, proposalId: proposal.id, phase: input.phase };
      }

      // Caducidade (CC art. 431): aceite após validUntil não vincula. Compara com
      // a HORA REAL do aceite (completed_at do payload), não com o relógio de
      // processamento — senão um aceite tempestivo (23:59) cujo webhook chega/
      // reprocessa depois do vencimento (00:05) seria descartado indevidamente.
      const acceptedAtReal = facts.completedAt ? new Date(facts.completedAt) : new Date();
      const acceptedAtValid = !Number.isNaN(acceptedAtReal.getTime());
      if (proposal.validUntil && acceptedAtValid && acceptedAtReal > proposal.validUntil) {
        const adv = await advanceProposalStatus(proposal.id, "expirada", { expiredAt: new Date() });
        // Sino SÓ quando a transição de fato aconteceu: evento tardio/replay
        // numa proposta cancelada/convertida não pode tocar sino falso (e
        // consumiria o batchId de um marco legítimo futuro).
        if (adv.moved) {
          waitUntil(
            notifyProposalMilestone({
              proposalId: proposal.id,
              orgId: proposal.orgId,
              userId: proposal.userId,
              kind: "expired",
            })
          );
        }
        return { ok: true, handled: true, proposalId: proposal.id, phase: input.phase };
      }

      // O proponente aceitou dentro do prazo. FLIP 2026-08 (paridade com o
      // envelope): com VENDEDOR cadastrado a proposta PARA na decisão humana
      // (assinada_proponente) — não fecha completa nem toca o sino completed;
      // o comprovante do aceite do proponente continua sendo gerado abaixo.
      // Escape hatch por org (`proposalAutoChainVendedor`) dispara a 2ª rodada
      // do Aceite automaticamente.
      {
        const advAssinada = await advanceProposalStatus(proposal.id, "assinada_proponente");
        const vendedores = await prisma.proposalSigner.count({
          where: { proposalId: proposal.id, included: true, role: "vendedor" },
        });
        if (vendedores === 0) {
          const advCompleta = await advanceProposalStatus(proposal.id, "completa", {
            completedAt: new Date(),
          });
          if (advCompleta.moved) {
            waitUntil(
              notifyProposalMilestone({
                proposalId: proposal.id,
                orgId: proposal.orgId,
                userId: proposal.userId,
                kind: "completed",
              })
            );
          }
        } else {
          const settings = await getSignatureSettings(proposal.orgId);
          if (settings.proposalAutoChainVendedor) {
            if (advAssinada.moved) {
              waitUntil(
                notifyProposalMilestone({
                  proposalId: proposal.id,
                  orgId: proposal.orgId,
                  userId: proposal.userId,
                  kind: "signed_proponente",
                })
              );
            }
            waitUntil(
              sendVendedorVia(proposal.id, "webhook").catch((err) => {
                console.error("[proposals] sendVendedorVia (aceite) falhou:", err);
              })
            );
          } else if (advAssinada.moved) {
            await prisma.proposalEvent
              .create({
                data: {
                  proposalId: proposal.id,
                  eventName: "awaiting_owner_decision",
                  source: "system",
                  payload: { vendedores, instrument: "aceite" } as Prisma.InputJsonValue,
                },
              })
              .catch(() => {});
            waitUntil(
              notifyProposalMilestone({
                proposalId: proposal.id,
                orgId: proposal.orgId,
                userId: proposal.userId,
                kind: "awaiting_decision",
              })
            );
          }
        }
      }

      // Comprovante durável — o requisito central do modo Aceite. Fire-and-forget
      // (idempotente por dossierUrl). O texto aceito é reconstruído idêntico ao
      // enviado, pelo helper compartilhado.
      const link = proposalPublicLink(proposal.token);
      const acceptedText = buildAcceptanceMessage({
        numero: proposal.id.slice(-8),
        title: proposal.title,
        link,
      });
      // ENCADEADO, não paralelo: o sync busca na ClickSign os dados OFICIAIS do
      // aceite (e tenta trazer o Registro do Aceite), e o comprovante precisa
      // deles pra carimbar a capa. Se o sync falhar, `facts` volta vazio e o
      // comprovante cai no comportamento antigo — nunca deixa de ser gerado.
      waitUntil(
        syncAcceptanceRecord({
          proposalId: proposal.id,
          orgId: proposal.orgId,
          acceptanceId: input.acceptanceId,
        })
          // syncAcceptanceRecord é best-effort e não deveria lançar, mas se
          // lançasse a cadeia pularia o comprovante — e ele é o ÚNICO artefato
          // do Aceite do nosso lado. Degrada pra "sem dados oficiais".
          .catch((err): AcceptanceRecordSyncResult => {
            console.error("[proposals] syncAcceptanceRecord falhou:", err);
            return { facts: {}, recordUrl: null, raw: null };
          })
          .then((sync) =>
            buildAcceptanceProof(proposal.id, {
              signerName: facts.signerName ?? sync.facts.signerName ?? "—",
              signerPhone: facts.signerPhone ?? sync.facts.signerPhone ?? "—",
              acceptanceId: input.acceptanceId,
              sentAt: facts.sentAt ?? sync.facts.sentAt ?? null,
              completedAt: facts.completedAt ?? new Date().toISOString(),
              acceptedText,
              official: sync.facts,
            })
          )
          .catch((err) => {
            console.error("[proposals] buildAcceptanceProof falhou:", err);
          })
      );
      break;
    }

    case "refused":
      // Quem recusou importa. O proponente recusar é terminal frio
      // (recusada_proponente). O VENDEDOR/proprietário recusar deixa um
      // comprador comprometido na mão → estado quente (recusada_vendedor).
      // Antes, sem o guard, a recusa de qualquer terceiro virava
      // "recusada_proponente" — atribuição errada do desfecho.
      {
        const refusedBy = isProponente ? ("proponente" as const) : ("vendedor" as const);
        const advRef = await advanceProposalStatus(
          proposal.id,
          isProponente ? "recusada_proponente" : "recusada_vendedor",
          { refusedAt: new Date() }
        );
        if (advRef.moved) {
          // Suffix por signatário: recusas de partes diferentes = sinos distintos.
          waitUntil(
            notifyProposalMilestone({
              proposalId: proposal.id,
              orgId: proposal.orgId,
              userId: proposal.userId,
              kind: "refused",
              refusedBy,
              dedupeSuffix: signer?.id,
            })
          );
        }
      }
      break;

    case "expired":
      // Só o vencimento do termo do PROPONENTE (o vinculante) expira a proposta.
      // O termo de um terceiro expirar não mata o negócio — o proponente ainda
      // pode aceitar. Sem o guard, a expiração de qualquer termo terminava tudo.
      if (isProponente) {
        const advExp = await advanceProposalStatus(proposal.id, "expirada", {
          expiredAt: new Date(),
        });
        if (advExp.moved) {
          waitUntil(
            notifyProposalMilestone({
              proposalId: proposal.id,
              orgId: proposal.orgId,
              userId: proposal.userId,
              kind: "expired",
            })
          );
        }
      } else if (signer?.role === "vendedor") {
        await returnVendedorAceiteToDecision(proposal, signer.id, input.phase);
      }
      break;

    case "canceled":
      // Idem: só o cancelamento do termo do proponente cancela a proposta.
      if (isProponente) {
        await advanceProposalStatus(proposal.id, "cancelada", { canceledAt: new Date() });
      } else if (signer?.role === "vendedor") {
        await returnVendedorAceiteToDecision(proposal, signer.id, input.phase);
      }
      break;

    default:
      // created/error/desconhecido: só o log acima (sem mutação de status).
      return { ok: true, handled: false, proposalId: proposal.id, phase: input.phase };
  }

  return { ok: true, handled: true, proposalId: proposal.id, phase: input.phase };
}
