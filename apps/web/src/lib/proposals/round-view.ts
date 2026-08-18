/**
 * "Rodada" da proposta — a visão de LISTA do fluxo em duas vias.
 *
 * O `status` técnico responde "onde a máquina de estados está"; a rodada
 * responde a pergunta do corretor na listagem: "isso está na 1ª via, parado na
 * minha decisão, com o proprietário, travado ou terminou?". É PURA de
 * propósito (client-safe, sem prisma): quem chama resolve `hasActiveVendedorVia`
 * do jeito que puder (a lista usa 1 query batch de envelopes `via="reduzida"`
 * em `running|closed` — sem N+1).
 */

export type ProposalRound =
  | "primeira_via"
  | "decisao"
  | "segunda_via_enviada"
  | "segunda_via_falhou"
  | "concluida"
  | "encerrada";

export const ROUND_LABELS: Record<ProposalRound, string> = {
  primeira_via: "1ª via — proponente",
  decisao: "Aguardando sua decisão",
  segunda_via_enviada: "2ª via — com o proprietário",
  segunda_via_falhou: "2ª via falhou",
  concluida: "Concluída",
  encerrada: "Encerrada",
};

const PRIMEIRA_VIA = new Set([
  "rascunho",
  "aguardando_aprovacao",
  "falha_envio",
  "enviada",
  "entregue",
  "visualizada",
]);

const ENCERRADA = new Set([
  "recusada_proponente",
  "recusada_vendedor",
  "expirada",
  "cancelada",
]);

export function proposalRoundView(input: {
  status: string;
  /**
   * A 2ª via (envelope/aceite do proprietário) existe e está viva
   * (`running|closed`)? Só é consultado em `aguardando_vendedor` — nos demais
   * statuses o valor é irrelevante e pode vir `false`.
   */
  hasActiveVendedorVia: boolean;
}): ProposalRound {
  const { status } = input;
  if (PRIMEIRA_VIA.has(status)) return "primeira_via";
  if (status === "assinada_proponente") return "decisao";
  if (status === "aguardando_vendedor") {
    return input.hasActiveVendedorVia ? "segunda_via_enviada" : "segunda_via_falhou";
  }
  if (status === "completa" || status === "convertida") return "concluida";
  if (ENCERRADA.has(status)) return "encerrada";
  return "encerrada";
}
