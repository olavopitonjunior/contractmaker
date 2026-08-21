/**
 * Mapeia os status técnicos da proposta pra 4 estados que o corretor lê —
 * "de quem é a bola?". Os técnicos vivem no banco; a UI mostra estes.
 *
 * Cores em TOKENS SEMÂNTICOS (success/warning/info/destructive) — dark-mode
 * seguro (auto-adaptam). Nada de `text-blue-700` cru, que não tem variante dark.
 */
import { lastSendOutcomeIsCancel } from "./status-sets";

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

/**
 * `lastSendOutcome` é o nome do evento mais recente dentre `SEND_OUTCOME_EVENTS`
 * (`primeira_via_canceled` | `send_failed` | `null`), resolvido no servidor.
 *
 * NÃO use `sentAt` para isto. Ele responde "já circulou alguma vez?" e é
 * monotônico, então depois de `enviar → cancelar → reenviar` uma falha REAL do
 * reenvio ainda apareceria como "Envio cancelado" — exatamente o fluxo que
 * esta distinção existe pra servir. O evento é durável e sobrevive a reenvios.
 *
 * Obrigatório (aceita `null`) e não opcional: com default, um chamador novo
 * mostraria o rótulo errado sem erro de compilação.
 *
 * Só o RÓTULO e a COR mudam; o bucket segue `sua_vez` nos dois casos, porque em
 * ambos a bola é do corretor (reenviar ou arquivar).
 */
export function proposalStatusView(
  status: string,
  lastSendOutcome: string | null
): StatusView {
  switch (status) {
    case "rascunho":
      return view("Rascunho", "sua_vez", ENCERRADA);
    case "aguardando_aprovacao":
      return view("Max sugeriu", "sua_vez", VIOLET);
    case "falha_envio":
      // Cancelar o envelope de propósito devolve a proposta pra cá. Chamar isso
      // de "Falha no envio", em vermelho, culpa o sistema por um ato do
      // corretor — e gasta a credibilidade do badge vermelho pra quando houver
      // falha de verdade. Âmbar: precisa de ação, não deu errado.
      return lastSendOutcomeIsCancel(lastSendOutcome)
        ? view("Envio cancelado", "sua_vez", WARNING)
        : view("Falha no envio", "sua_vez", DESTRUCTIVE);
    case "enviada":
      return view("Enviada", "cliente", INFO);
    case "entregue":
      return view("Entregue", "cliente", INFO);
    case "visualizada":
      return view("Visualizou", "cliente", INFO);
    // Eram HOMÔNIMOS ("Aguardando vendedor") — o corretor não distinguia a
    // parada de decisão (bola dele) da 2ª via em curso (bola do proprietário).
    case "assinada_proponente":
      return view("Aguardando sua decisão", "sua_vez", WARNING);
    case "aguardando_vendedor":
      return view("Com o proprietário", "proprietario", WARNING);
    case "completa":
      // Bucket continua "sua_vez" (a bola É do corretor), mas o texto diz QUAL
      // ação — "Completa · Sua vez" seco parecia pendência numa proposta
      // encerrada (achado de QA 2026-08-18).
      return { ...view("Completa", "sua_vez", SUCCESS), turn: "Sua vez — converter em negócio" };
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
  chained_envelope2: "Enviado ao proprietário",
  chained_envelope2_pending: "Aguardando envio ao proprietário",
  send_counterparty: "Enviado ao proprietário",
  closed: "Concluída",
  refused: "Recusada",
  expired: "Expirada",
  canceled: "Cancelada",
  converted: "Virou negócio",
  reminder_sent: "Lembrete enviado",
  assignee_changed: "Responsável alterado",
  status_transition_rejected: "Transição de status rejeitada",
  // Nomes REAIS gravados por send-execute.ts (os 5 chained_envelope2_* caíam
  // no fallback cru na timeline — 2026-08).
  chained_envelope2_sent: "2ª via enviada ao proprietário",
  chained_envelope2_failed: "Falha ao enviar a 2ª via",
  chained_envelope2_budget_exceeded: "2ª via bloqueada — orçamento de assinaturas",
  chained_envelope2_preflight_failed: "2ª via bloqueada — dados do proprietário incompletos",
  chained_envelope2_no_creds: "2ª via bloqueada — ClickSign não configurada",
  manual_sync: "Sincronização manual",
  envelope_replaced: "Envelope anterior substituído",
  chained_envelope2_wrong_status: "2ª via bloqueada — proposta fora do ponto de envio",
  vendedor_via_canceled: "2ª via cancelada/expirada — voltou pra sua decisão",
  // Os dois lados do cancelamento de envelope pela UI (2026-08): a rota grava
  // `envelope_canceled`, e o hook que devolve a 1ª via pra reenvio grava
  // `primeira_via_canceled`. Nenhum dos dois tinha rótulo — a timeline mostrava
  // o nome técnico cru justamente no evento que explica por que a proposta
  // "voltou".
  envelope_canceled: "Envelope cancelado",
  primeira_via_canceled: "Envio cancelado — liberada pra reenvio",
  send_failed: "Envio não completou — liberada pra reenvio",
  // Thread de recriação (2026-08-20): o pai registra quem o substituiu e a
  // filha registra de onde veio. São eventos de timeline apenas (nenhum canal
  // externo — ver comentário no POST /api/proposals).
  superseded_by_recreation: "Substituída por recriação",
  recreated_from: "Criada por recriação de proposta anterior",
  // Gravado pelo cron de claim órfão LOGO APÓS o send_failed do releaseClaim —
  // sem rótulo ele aparecia cru ao lado de um evento bem-rotulado.
  send_claim_recovered: "Recuperação automática — envio interrompido",
  // Parada de decisão / conclusão manual (Fase 2 do plano 2026-08-06).
  awaiting_owner_decision: "Aguardando sua decisão",
  completed_manually: "Concluída sem enviar ao proprietário",
  signer_added: "Signatário adicionado",
  // Aceite (WhatsApp) — 2ª rodada, paridade com o envelope.
  chained_aceite2_sent: "2ª via (aceite) enviada ao proprietário",
  chained_aceite2_failed: "Falha ao enviar a 2ª via (aceite)",
  chained_aceite2_budget_exceeded: "2ª via (aceite) bloqueada — orçamento",
  chained_aceite2_preflight_failed: "2ª via (aceite) bloqueada — dados incompletos",
  chained_aceite2_no_creds: "2ª via (aceite) bloqueada — ClickSign não configurada",
};

export function proposalEventLabel(eventName: string): string {
  if (EVENT_LABEL[eventName]) return EVENT_LABEL[eventName];
  if (eventName.startsWith("acceptance_term_")) {
    return `Termo de aceite — ${eventName.slice("acceptance_term_".length)}`;
  }
  // Fallback por PREFIXO: variantes futuras de 2ª via ganham um rótulo genérico
  // legível em vez do nome técnico cru.
  if (eventName.startsWith("chained_envelope2_")) return "2ª via — atualização";
  if (eventName.startsWith("chained_aceite2_")) return "2ª via (aceite) — atualização";
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
  { key: "vendedor", label: "Proprietário" },
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

// Terminais negativos NÃO estão no TIMELINE_INDEX (não são nós da jornada), mas o
// componente precisa saber ONDE a proposta morreu pra pintar o nó certo de vermelho
// — senão colapsava tudo no nó 0 ("morreu na criação"), escondendo o histórico.
// Índice inferido do PONTO em que o status implica que ela chegou.
const NEGATIVE_REACHED: Record<string, number> = {
  recusada_proponente: 4, // recusou no passo do proponente
  recusada_vendedor: 5, // proponente já assinou; recusou no passo do vendedor
  expirada: 1, // ao menos foi enviada (expiração é timeout pós-envio)
  cancelada: 1, // cancelamento é permitido de enviada+ (min. razoável)
};

/**
 * Índice do nó mais avançado alcançado + se a proposta morreu num terminal
 * negativo (recusa/expiração/cancelamento) — o componente pinta o fim de vermelho.
 */
export function proposalTimelineStage(status: string): {
  reachedIndex: number;
  negative: boolean;
} {
  return {
    reachedIndex: TIMELINE_INDEX[status] ?? NEGATIVE_REACHED[status] ?? 0,
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
