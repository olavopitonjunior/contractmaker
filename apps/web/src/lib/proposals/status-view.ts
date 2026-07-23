/**
 * Mapeia os status técnicos da proposta pra 4 estados que o corretor lê —
 * "de quem é a bola?". Os técnicos vivem no banco; a UI mostra estes.
 *
 * Cores em TOKENS SEMÂNTICOS (success/warning/info/destructive) — dark-mode
 * seguro (auto-adaptam). Nada de `text-blue-700` cru, que não tem variante dark.
 */
export interface StatusView {
  label: string;
  /** "sua_vez" | "cliente" | "proprietario" | "encerrada" */
  bucket: "sua_vez" | "cliente" | "proprietario" | "encerrada";
  /** Frase curta "de quem é a bola" pra reforçar o status na UI. */
  turn: string;
  /** Classes de Badge outline (border + text), dark-safe. */
  className: string;
}

const INFO = "border-info/40 text-info";
const WARNING = "border-warning/50 text-warning";
const SUCCESS = "border-success/50 text-success";
const ENCERRADA = "border-border text-muted-foreground";
const DESTRUCTIVE = "border-destructive/50 text-destructive";
const VIOLET = "border-violet-400 text-violet-600 dark:text-violet-400";

const TURN: Record<StatusView["bucket"], string> = {
  sua_vez: "Sua vez",
  cliente: "Com o cliente",
  proprietario: "Com o proprietário",
  encerrada: "Encerrada",
};

function view(
  label: string,
  bucket: StatusView["bucket"],
  className: string
): StatusView {
  return { label, bucket, turn: TURN[bucket], className };
}

export function proposalStatusView(status: string): StatusView {
  switch (status) {
    case "rascunho":
      return view("Rascunho", "sua_vez", ENCERRADA);
    case "aguardando_aprovacao":
      return view("Max sugeriu", "sua_vez", VIOLET);
    case "falha_envio":
      return view("Falha no envio", "sua_vez", DESTRUCTIVE);
    case "enviada":
      return view("Enviada", "cliente", INFO);
    case "entregue":
      return view("Entregue", "cliente", INFO);
    case "visualizada":
      return view("Visualizou", "cliente", INFO);
    case "assinada_proponente":
      return view("Aguardando vendedor", "proprietario", WARNING);
    case "aguardando_vendedor":
      return view("Aguardando vendedor", "proprietario", WARNING);
    case "completa":
      return view("Completa", "sua_vez", SUCCESS);
    case "convertida":
      return view("Virou negócio", "encerrada", SUCCESS);
    case "recusada_proponente":
      return view("Recusada", "encerrada", DESTRUCTIVE);
    case "recusada_vendedor":
      return view("Recusada pelo dono", "sua_vez", DESTRUCTIVE);
    case "expirada":
      return view("Expirada", "encerrada", ENCERRADA);
    case "cancelada":
      return view("Cancelada", "encerrada", ENCERRADA);
    default:
      return view(status, "encerrada", ENCERRADA);
  }
}

/**
 * Rótulo por signatário a partir do `ProposalSigner.acceptanceStatus`
 * (sent | completed | refused | expired). Cores em tokens (dark-safe).
 */
export function signerStatusLabel(
  acceptanceStatus: string | null | undefined
): { label: string; className: string } {
  switch (acceptanceStatus) {
    case "completed":
      return { label: "Assinou", className: "text-success" };
    case "refused":
      return { label: "Recusou", className: "text-destructive" };
    case "canceled":
      return { label: "Cancelado", className: "text-muted-foreground" };
    case "expired":
      return { label: "Expirou", className: "text-muted-foreground" };
    case "sent":
      return { label: "Aguardando", className: "text-info" };
    default:
      return { label: "Pendente", className: "text-muted-foreground" };
  }
}

/**
 * Traduz o `ProposalEvent.eventName` técnico pro histórico legível ao corretor.
 * Fallback = o próprio nome cru.
 */
const EVENT_LABEL: Record<string, string> = {
  sent: "Enviada",
  delivered: "Entregue",
  fetched: "Baixada",
  viewed: "Visualizada",
  signed_proponente: "Proponente assinou",
  chained_envelope2: "Enviado ao vendedor",
  chained_envelope2_pending: "Aguardando envio ao vendedor",
  send_counterparty: "Enviado ao vendedor",
  closed: "Concluída",
  refused: "Recusada",
  expired: "Expirada",
  canceled: "Cancelada",
  converted: "Virou negócio",
  reminder_sent: "Lembrete enviado",
  assignee_changed: "Responsável alterado",
  status_transition_rejected: "Transição de status rejeitada",
};

export function proposalEventLabel(eventName: string): string {
  if (EVENT_LABEL[eventName]) return EVENT_LABEL[eventName];
  if (eventName.startsWith("acceptance_term_")) {
    return `Termo de aceite — ${eventName.slice("acceptance_term_".length)}`;
  }
  return eventName;
}

// ── Linha do tempo da proposta ──────────────────────────────────────────────

export interface TimelineNode {
  key: string;
  label: string;
}

/** Nós da jornada, em ordem. O componente deriva reached/current/future. */
export const PROPOSAL_TIMELINE: TimelineNode[] = [
  { key: "criada", label: "Criada" },
  { key: "enviada", label: "Enviada" },
  { key: "entregue", label: "Entregue" },
  { key: "visualizada", label: "Visualizada" },
  { key: "assinada", label: "Proponente" },
  { key: "vendedor", label: "Vendedor" },
  { key: "completa", label: "Completa" },
  { key: "convertida", label: "Negócio" },
];

const TIMELINE_INDEX: Record<string, number> = {
  rascunho: 0,
  aguardando_aprovacao: 0,
  falha_envio: 0,
  enviada: 1,
  entregue: 2,
  visualizada: 3,
  assinada_proponente: 4,
  aguardando_vendedor: 5,
  completa: 6,
  convertida: 7,
};

const NEGATIVE_TERMINALS = new Set([
  "recusada_proponente",
  "recusada_vendedor",
  "expirada",
  "cancelada",
]);

/**
 * Índice do nó mais avançado alcançado + se a proposta morreu num terminal
 * negativo (recusa/expiração/cancelamento) — o componente pinta o fim de vermelho.
 */
export function proposalTimelineStage(status: string): {
  reachedIndex: number;
  negative: boolean;
} {
  return {
    reachedIndex: TIMELINE_INDEX[status] ?? 0,
    negative: NEGATIVE_TERMINALS.has(status),
  };
}

// ── Responsável (corretor) ──────────────────────────────────────────────────

/**
 * Nome exibido do responsável, por precedência: nome livre (não-usuário) →
 * usuário responsável → criador. `isNonUser` marca o nome livre (chip "externo").
 */
export function responsibleDisplay(p: {
  responsibleName: string | null;
  responsibleUser: { name: string | null; image: string | null } | null;
  user: { name: string | null } | null;
}): { name: string; isNonUser: boolean; image: string | null } {
  if (p.responsibleName) {
    return { name: p.responsibleName, isNonUser: true, image: null };
  }
  if (p.responsibleUser?.name) {
    return { name: p.responsibleUser.name, isNonUser: false, image: p.responsibleUser.image };
  }
  return { name: p.user?.name ?? "—", isNonUser: false, image: null };
}

/** Iniciais (2 letras) pra AvatarFallback. */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
