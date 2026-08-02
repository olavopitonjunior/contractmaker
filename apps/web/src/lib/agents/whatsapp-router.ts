/**
 * Qual agente de WhatsApp atende este tenant — e o despacho unificado.
 *
 * A plataforma tem dois: o **Newton** (OpenClaw, número pareado por QR, turn em
 * linguagem natural) e o **Max** (serviço LangGraph próprio sobre a WhatsApp
 * Cloud API oficial, dos tenants RE/MAX). A escolha é de CONFIGURAÇÃO, por org,
 * via as features `vendas.max`/`locacao.max` e `vendas.newton`/`locacao.newton`
 * — todas default OFF.
 *
 * **Precedência: Max ganha.** Ter os dois ligados no mesmo módulo é configuração
 * inválida (o destinatário receberia a mesma notificação de dois números). Como
 * o catálogo não sabe expressar exclusão mútua, o desempate mora aqui, num lugar
 * só, em vez de virar um `if` copiado em quatro call-sites.
 *
 * Os call-sites de notificação não devem mais falar com nenhum trigger direto:
 * chamam `dispatchWhatsappNotify` e traduzem o resultado para o log deles.
 */

import { isMaxEnabledForDeal, isMaxEnabledForOrg } from "@/lib/max/gate";
import {
  isNewtonEnabledForDeal,
  isNewtonEnabledForOrg,
} from "@/lib/newton/gate";
import { triggerMaxNotify } from "@/lib/max/notify-trigger";
import { triggerNewtonNotify } from "@/lib/newton/notify-trigger";

export type WhatsappAgent = "max" | "newton";

/**
 * Agente do tenant, ou `null` quando nenhum está habilitado (o caso comum: as
 * quatro features nascem OFF).
 *
 * `dealKind` ausente = "tem algum agente em qualquer módulo?", usado onde o tipo
 * do negócio não é conhecido (notificação de sistema ao usuário da plataforma).
 * Nunca lança: falha de leitura de módulo vira "sem agente", que é o estado
 * seguro — não mandar é recuperável, mandar pelo agente errado não.
 */
export async function resolveWhatsappAgent(
  orgId: string,
  dealKind?: string
): Promise<WhatsappAgent | null> {
  const maxOn = await (dealKind
    ? isMaxEnabledForDeal(orgId, dealKind)
    : isMaxEnabledForOrg(orgId)
  ).catch(() => false);
  if (maxOn) return "max";

  const newtonOn = await (dealKind
    ? isNewtonEnabledForDeal(orgId, dealKind)
    : isNewtonEnabledForOrg(orgId)
  ).catch(() => false);
  return newtonOn ? "newton" : null;
}

export interface WhatsappNotifyArgs {
  orgId: string;
  /**
   * `deal_party` (cliente final) só é aceito no caminho do Max, onde é uma
   * mensagem informativa simples. No Newton essa audiência tem um fluxo
   * próprio (NewtonRequest com cobrança e inbox) que não passa por aqui.
   */
  audience: "platform_user" | "deal_broker" | "deal_party";
  phone: string;
  recipientName: string;
  title: string;
  body: string;
  /**
   * Sufixo que o Newton concatena ao corpo — hoje "Acompanhe em <url>".
   *
   * Existe porque os dois transportes renderizam os MESMOS fatos de formas
   * diferentes: o Newton recebe uma frase única pra transmitir, enquanto o Max
   * manda título, corpo e link em campos separados (viram `{{1}}`/`{{2}}` e
   * botão no template da Meta). Sem isso, unificar mudaria o texto que os
   * tenants do Newton já recebem hoje.
   */
  newtonTrailer?: string | null;
  linkUrl?: string | null;
  dealId?: string | null;
  /**
   * Nome fantasia da imobiliária. `null` é significativo no Newton: o turn OMITE
   * a menção à org quando não há marca cadastrada, e forçar um genérico ali
   * produziria "operador da imobiliária imobiliária". O Max precisa de um valor
   * (vira variável de template — um número único atende os três tenants
   * RE/MAX), então o fallback é aplicado só no ramo dele.
   */
  orgName: string | null;
  /** Idempotência ponta a ponta — id da linha de log/entrega que originou o envio. */
  dedupeKey: string;
}

export type WhatsappDispatchResult =
  | { status: "sent"; detail: Record<string, unknown> }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

/**
 * Despacha por `agent`. O chamador já resolveu o agente (normalmente porque
 * precisa saber se é Max pra decidir sobre a janela de cortesia — ver abaixo),
 * então recebê-lo pronto evita uma segunda leitura de módulos.
 *
 * **Janela 7h–22h:** o Newton não tem fila, então quem chama precisa segurar a
 * mensagem fora da janela (e o motor de deal, que não tem reconciliação,
 * descarta). O Max tem outbox: aceita a qualquer hora e agenda a entrega pra
 * próxima abertura. Por isso os call-sites checam a janela SÓ no caminho do
 * Newton — a regra não sumiu, mudou de dono.
 */
export async function dispatchWhatsappNotify(
  agent: WhatsappAgent,
  a: WhatsappNotifyArgs
): Promise<WhatsappDispatchResult> {
  if (agent === "max") {
    const r = await triggerMaxNotify({
      orgId: a.orgId,
      audience: a.audience,
      phone: a.phone,
      recipientName: a.recipientName,
      title: a.title,
      body: a.body,
      linkUrl: a.linkUrl ?? null,
      dealId: a.dealId ?? null,
      orgName: a.orgName ?? "imobiliária",
      dedupeKey: a.dedupeKey,
    });
    if (r.status === "sent") {
      return { status: "sent", detail: { via: "max", maxNotifyId: r.id } };
    }
    return r;
  }

  if (a.audience === "deal_party") {
    // Chamada indevida, não configuração ruim: o caminho do Newton pra parte é
    // o NewtonRequest, montado em deal-events.ts.
    return { status: "skipped", reason: "audiencia_party_nao_suportada_no_newton" };
  }

  const outcome = await triggerNewtonNotify({
    orgId: a.orgId,
    audience: a.audience,
    phone: a.phone,
    recipientName: a.recipientName,
    message: a.newtonTrailer
      ? `${a.title}: ${a.body} ${a.newtonTrailer}`
      : `${a.title}: ${a.body}`,
    dealId: a.dealId ?? undefined,
    orgName: a.orgName,
    linkUrl: a.linkUrl ?? null,
  });

  if (outcome === "skipped") {
    return { status: "skipped", reason: "newton_gate_off_ou_sidecar_ausente" };
  }
  return {
    status: "sent",
    detail: {
      via: a.audience === "platform_user" ? "platform_user" : "newton_sidecar",
    },
  };
}
