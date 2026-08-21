/**
 * Schema compartilhado de escrita de cláusula (KnowledgeItem category="clause")
 * — usado pelo server (POST /api/clauses, PATCH /api/clauses/[id]) e pelo
 * editor client (RHF + zodResolver), pra fechar validação dos dois lados sem
 * divergir.
 *
 * Deliberadamente PERMISSIVO em subcategory (qualquer slug não-vazio): o
 * acervo tem valores legados de várias safras (seeds de venda/locação,
 * migração da unificação 2026-05-18, cláusulas de plataforma) e um enum
 * estrito tornaria linhas antigas ineditáveis. A lista canônica abaixo é
 * sugestão de UI (Select), não gate de API.
 */
import { z } from "zod";

export const CLAUSE_GROUP_CODES = ["G1", "G2", "G3", "G4", "G5", "G6"] as const;

export const GROUP_LABELS: Record<string, string> = {
  G1: "G1 — Sinal, Arras e Início de Pagamento",
  G2: "G2 — Imissão na Posse",
  G3: "G3 — Rescisão e Condição Resolutiva",
  G4: "G4 — Financiamento e Registro",
  G5: "G5 — Comissão de Corretagem",
  G6: "G6 — Declarações e Disposições Especiais",
};

/** Sugestões de subcategoria pro Select do editor — derivadas dos seeds de
 *  venda e locação + genéricas em uso. Valor fora da lista continua válido. */
export const CLAUSE_SUBCATEGORY_SUGGESTIONS = [
  // venda
  "sinal",
  "imissao",
  "rescisao",
  "financiamento",
  "fgts",
  "corretagem",
  "declaracoes",
  // locação
  "garantia",
  "reajuste",
  "benfeitorias",
  "vistoria",
  "uso",
  "encargos",
  "devolucao",
  "preferencia",
  "renovatoria",
  // genéricas
  "partes",
  "objeto",
  "preco",
  "posse",
  "customizada",
] as const;

export const CLAUSE_STATUSES = ["approved", "pending", "draft"] as const;

/** Modalidades com fixture de preview (espelha SAMPLE_BY_MODALIDADE de
 *  lib/templates/preview-sample-data — fonte única pro Select da UI e pro enum
 *  da rota /api/clauses/preview; duplicar as listas foi achado de review). */
export const CLAUSE_PREVIEW_MODALIDADES = [
  { value: "a_vista", label: "Venda à vista" },
  { value: "financiamento", label: "Venda com financiamento" },
  { value: "locacao", label: "Locação residencial" },
  { value: "locacao_comercial", label: "Locação comercial" },
  { value: "temporada", label: "Locação por temporada" },
  { value: "administracao_locacao", label: "Administração de locação" },
] as const;

export const CLAUSE_PREVIEW_MODALIDADE_VALUES = CLAUSE_PREVIEW_MODALIDADES.map(
  (m) => m.value
) as ["a_vista", "financiamento", "locacao", "locacao_comercial", "temporada", "administracao_locacao"];

export const clauseWriteSchema = z.object({
  title: z.string().trim().min(1, "Título é obrigatório").max(200),
  content: z.string().trim().min(1, "Conteúdo é obrigatório").max(50_000),
  subcategory: z.string().trim().min(1).max(60),
  groupCode: z.enum(CLAUSE_GROUP_CODES).nullable().optional(),
  isVariable: z.boolean().optional(),
  agentNotes: z.string().trim().max(4_000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  status: z.enum(CLAUSE_STATUSES).optional(),
  source: z.string().trim().max(40).optional(),
});

export type ClauseWriteInput = z.infer<typeof clauseWriteSchema>;

/**
 * Normaliza o body das rotas legadas pro shape do schema: `category` era o
 * nome antigo de `subcategory` e `description` o de `agentNotes` (a UI velha
 * mandava os dois nomes). Campo AUSENTE continua ausente — crítico pro PATCH
 * parcial (defaultar aqui apagaria subcategory/agentNotes de quem não os
 * enviou). O default "customizada" do POST fica no call-site do POST.
 */
export function normalizeClauseBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };
  if (out.subcategory === undefined && out.category !== undefined) {
    out.subcategory = out.category;
  }
  if (out.agentNotes === undefined && out.description !== undefined) {
    out.agentNotes = out.description;
  }
  if (out.groupCode === "" || out.groupCode === "none") out.groupCode = null;
  return out;
}
