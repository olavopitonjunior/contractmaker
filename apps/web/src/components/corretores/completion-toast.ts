/**
 * Tradução do resultado por canal de POST .../request-completion pro toast.
 * Compartilhado por CorretoresClient, SplitRecipientsClient (lente financeira)
 * e CadastroRecebimento (form público autenticado? não — wizard interno).
 * A resposta é { ok: boolean, channels: Record<"email"|"whatsapp", string> } —
 * ok=false significa que NENHUM canal enviou (e o link anterior já foi
 * invalidado pela rotação do token; oriente a tentar de novo).
 */

const WHATSAPP_SKIP_LABEL: Record<string, string> = {
  fora_da_janela: "fora da janela (7h–22h)",
  sem_agente_de_whatsapp_para_a_org: "sem agente de WhatsApp configurado",
};

export function describeChannel(channel: string, result: string): string {
  const name = channel === "email" ? "Email" : "WhatsApp";
  if (result === "sent") return `${name} enviado`;
  if (result.startsWith("skipped")) {
    const reason = result.slice("skipped:".length).trim();
    return `${name}: ${WHATSAPP_SKIP_LABEL[reason] ?? reason}`;
  }
  if (result.startsWith("failed")) {
    const reason = result.slice("failed:".length).trim();
    return `${name} falhou${reason ? ` (${reason})` : ""}`;
  }
  return `${name}: ${result}`;
}

/** Monta a mensagem agregada e diz se algo foi enviado. */
export function summarizeCompletion(data: unknown): { message: string; anySent: boolean } {
  const channels =
    data && typeof data === "object" && "channels" in data
      ? ((data as { channels?: Record<string, string> }).channels ?? {})
      : {};
  const parts = Object.entries(channels).map(([ch, r]) => describeChannel(ch, r));
  const anySent = Object.values(channels).some((r) => r === "sent");
  const message =
    parts.length > 0
      ? anySent
        ? parts.join(" · ")
        : `Nada foi enviado (${parts.join(" · ")}) — o link anterior foi invalidado; corrija o canal e tente de novo`
      : "Link gerado";
  return { message, anySent };
}
