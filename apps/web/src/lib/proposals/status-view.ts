/**
 * Mapeia os 11 status técnicos da proposta pra 4 estados que o corretor lê —
 * "de quem é a bola?". Os 11 vivem no banco; a UI mostra estes.
 */
export interface StatusView {
  label: string;
  /** "sua_vez" | "cliente" | "proprietario" | "encerrada" */
  bucket: "sua_vez" | "cliente" | "proprietario" | "encerrada";
  className: string;
}

const SUA_VEZ = "border-blue-500 text-blue-700";
const CLIENTE = "border-sky-400 text-sky-700";
const PROPRIETARIO = "border-amber-500 text-amber-700";
const ENCERRADA = "border-muted text-muted-foreground";
const VERDE = "border-emerald-500 text-emerald-700";

export function proposalStatusView(status: string): StatusView {
  switch (status) {
    case "rascunho":
      return { label: "Rascunho", bucket: "sua_vez", className: ENCERRADA };
    case "aguardando_aprovacao":
      return { label: "Max sugeriu", bucket: "sua_vez", className: "border-violet-500 text-violet-700" };
    case "falha_envio":
      return { label: "Falha no envio", bucket: "sua_vez", className: "border-destructive text-destructive" };
    case "enviada":
      return { label: "Enviada", bucket: "cliente", className: CLIENTE };
    case "entregue":
      return { label: "Entregue", bucket: "cliente", className: CLIENTE };
    case "visualizada":
      return { label: "Visualizou", bucket: "cliente", className: CLIENTE };
    case "assinada_proponente":
      return { label: "Aguardando vendedor", bucket: "proprietario", className: PROPRIETARIO };
    case "aguardando_vendedor":
      return { label: "Aguardando vendedor", bucket: "proprietario", className: PROPRIETARIO };
    case "completa":
      return { label: "Completa", bucket: "sua_vez", className: VERDE };
    case "convertida":
      return { label: "Virou negócio", bucket: "encerrada", className: VERDE };
    case "recusada_proponente":
      return { label: "Recusada", bucket: "encerrada", className: "border-destructive text-destructive" };
    case "recusada_vendedor":
      return { label: "Recusada pelo dono", bucket: "sua_vez", className: "border-destructive text-destructive" };
    case "expirada":
      return { label: "Expirada", bucket: "encerrada", className: ENCERRADA };
    case "cancelada":
      return { label: "Cancelada", bucket: "encerrada", className: ENCERRADA };
    default:
      return { label: status, bucket: "encerrada", className: ENCERRADA };
  }
}

/**
 * Rótulo por signatário a partir do `ProposalSigner.acceptanceStatus`
 * (sent | completed | refused | expired) — antes a UI mostrava "—" fixo.
 */
export function signerStatusLabel(
  acceptanceStatus: string | null | undefined
): { label: string; className: string } {
  switch (acceptanceStatus) {
    case "completed":
      return { label: "Assinou", className: "text-emerald-700" };
    case "refused":
      return { label: "Recusou", className: "text-destructive" };
    case "expired":
      return { label: "Expirou", className: "text-muted-foreground" };
    case "sent":
      return { label: "Aguardando", className: "text-sky-700" };
    default:
      return { label: "Pendente", className: "text-muted-foreground" };
  }
}

/**
 * Traduz o `ProposalEvent.eventName` técnico (snake_case em inglês) pro
 * histórico legível ao corretor. Fallback = o próprio nome cru.
 */
const EVENT_LABEL: Record<string, string> = {
  sent: "Enviada",
  delivered: "Entregue",
  fetched: "Baixada",
  viewed: "Visualizada",
  signed_proponente: "Proponente assinou",
  chained_envelope2: "2º envelope encadeado",
  chained_envelope2_pending: "2º envelope — aguardando",
  closed: "Concluída",
  refused: "Recusada",
  expired: "Expirada",
  canceled: "Cancelada",
  converted: "Virou negócio",
  reminder_sent: "Lembrete enviado",
  status_transition_rejected: "Transição de status rejeitada",
};

export function proposalEventLabel(eventName: string): string {
  if (EVENT_LABEL[eventName]) return EVENT_LABEL[eventName];
  // acceptance_term_${phase} (Aceite via WhatsApp) — normaliza o prefixo.
  if (eventName.startsWith("acceptance_term_")) {
    return `Termo de aceite — ${eventName.slice("acceptance_term_".length)}`;
  }
  return eventName;
}
