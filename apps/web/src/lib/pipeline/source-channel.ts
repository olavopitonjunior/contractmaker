/**
 * Canal de entrada do negócio (`Deal.sourceChannel`) — a dimensão de ORIGEM que
 * antes não existia (conversão por canal só saía de heurísticas de join, nenhuma
 * exaustiva). Capturado no momento da criação do deal (não dá pra reconstruir
 * com precisão depois). Alimenta funil/relatório por canal.
 *
 * `kind` (venda|locacao) é ortogonal — o canal é o MESMO conceito nas duas
 * esteiras (um form público de locação e um de venda são ambos `form_publico`).
 */
export const DEAL_SOURCE_CHANNEL = {
  /** Lead preencheu o formulário público (venda ou locação). */
  FORM_PUBLICO: "form_publico",
  /** Corretor subiu uma PROPOSTA (PDF/DOCX) — OCR extrai os dados. */
  UPLOAD_PROPOSTA: "upload_proposta",
  /** Corretor subiu um CONTRATO já fechado (import). */
  IMPORT_CONTRATO: "import_contrato",
  /** Criação direta no pipeline ("Novo negócio"). */
  MANUAL: "manual",
  /** Conversão de uma Proposta (módulo Propostas) em negócio. */
  PROPOSTA: "proposta",
  /** Conversão de um Lead (Newton/WhatsApp) em negócio. */
  LEAD: "lead",
  /** Wizard de contrato de locação. */
  WIZARD: "wizard",
  /** Imóvel importado do catálogo iList (RE/MAX). */
  ILIST: "ilist",
} as const;

export type DealSourceChannel =
  (typeof DEAL_SOURCE_CHANNEL)[keyof typeof DEAL_SOURCE_CHANNEL];

/** Rótulos PT-BR pra UI/relatórios. */
export const DEAL_SOURCE_CHANNEL_LABEL: Record<DealSourceChannel, string> = {
  form_publico: "Formulário público",
  upload_proposta: "Upload de proposta",
  import_contrato: "Contrato importado",
  manual: "Cadastro manual",
  proposta: "Proposta convertida",
  lead: "Lead convertido",
  wizard: "Wizard de locação",
  ilist: "Importado do iList",
};
