/**
 * Resolvedor de destinatários "parte" de um deal — o público v2 das
 * notificações do processo (o v1 alcançava só corretores).
 *
 * A extração das partes titulares é compartilhada com as pesquisas de
 * satisfação (`lib/deals/parties.ts`); aqui em cima entram só as regras de
 * NOTIFICAÇÃO: dedupe por contato e uma `key` estável pro
 * `DealNotificationLog.recipientKey` — parte não tem id próprio (vive no
 * `dataJson` do form), então o contato É a identidade.
 */

import {
  dedupeParties,
  resolveTitularParties,
  type DealParty,
  type DealPartyRole,
} from "@/lib/deals/parties";

export interface PartyRecipient {
  /**
   * Chave do log: `party:<email|telefone>`. O prefixo evita colisão com o
   * `splitRecipientId` (cuid) usado pelo público `broker` na MESMA unique
   * (dealId, event, channel, recipientKey, dedupeKey).
   */
  key: string;
  role: DealPartyRole;
  label: string;
  email: string | null;
  phone: string | null;
}

export function partyRecipientKey(p: {
  email: string | null;
  phone: string | null;
}): string | null {
  const contact = p.email ?? p.phone;
  return contact ? `party:${contact}` : null;
}

/**
 * Partes titulares COM contato do deal, deduplicadas. Quem não tem e-mail nem
 * telefone fica de fora: não há canal, e uma linha de log sem destino só
 * poluiria o histórico do negócio.
 */
export async function resolveDealParties(params: {
  dealId: string;
  dealKind: string;
  formDataJson: unknown;
}): Promise<PartyRecipient[]> {
  const dealKind = params.dealKind === "locacao" ? "locacao" : "venda";
  const parties: DealParty[] = dedupeParties(
    await resolveTitularParties({
      dealId: params.dealId,
      dealKind,
      formDataJson: params.formDataJson,
    })
  );

  const out: PartyRecipient[] = [];
  for (const p of parties) {
    const key = partyRecipientKey(p);
    if (!key) continue;
    out.push({
      key,
      role: p.role,
      label: p.name,
      email: p.email,
      phone: p.phone,
    });
  }
  return out;
}
