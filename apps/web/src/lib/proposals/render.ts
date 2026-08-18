import { renderContratoHTML } from "@/lib/render/handlebars";
import { enrichContractData } from "@/lib/services/contract-generation";
import { enrichLocacaoData } from "@/lib/locacao/enrich";
import { sanitizeHiddenPaths } from "./hidden-fields";
import { formatDateBR } from "@/lib/format/datetime";

export type ProposalVia = "completa" | "reduzida";

/**
 * Enrich da esteira certa. `schemaType` começa com "locacao" nas propostas de
 * aluguel (locacao_residencial_v1, locacao_comercial_v1) — usar o enrich de
 * VENDA nelas injetava multas/prazos de compra e venda no contexto e materia-
 * lizava `comissao` mesmo quando o dado não existia (o `{{#if
 * comissao_incluida}}` do template imprimia o bloco de intermediação vazio).
 *
 * Nenhuma chave dos templates de proposta de locação vem do enrich de venda —
 * `locatarios`/`locadores`/`imovel`/`aluguel`/`garantia` são dados crus e
 * `numero_proposta`/`via_reduzida`/`comissao_incluida` são postos aqui.
 */
function enrichForSchema(
  schemaType: string,
  dataJson: Record<string, unknown>
): Record<string, unknown> {
  return schemaType.startsWith("locacao")
    ? enrichLocacaoData(dataJson)
    : enrichContractData(dataJson);
}

/**
 * Remove uma chave de um objeto aninhado por dot-path. Suporta índice de array
 * (`compradores.0.renda`).
 *
 * DELETA a chave — não seta "" nem null. É isto que faz o `{{#if existe X}}` do
 * Handlebars remover o BLOCO inteiro: um valor vazio renderizaria a moldura da
 * frase ("comissão de % sobre o valor") com um buraco no meio; a chave ausente
 * some a frase toda.
 *
 * Muta uma cópia — nunca o objeto de entrada. Retorna a cópia.
 */
export function unsetByPath<T extends Record<string, unknown>>(
  obj: T,
  path: string
): T {
  const parts = path.split(".");
  const clone = structuredClone(obj);
  let cur: unknown = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur == null || typeof cur !== "object") return clone; // path não existe
    cur = (cur as Record<string, unknown>)[parts[i]];
  }
  if (cur != null && typeof cur === "object") {
    delete (cur as Record<string, unknown>)[parts[parts.length - 1]];
  }
  return clone;
}

/**
 * Monta o contexto de render de UMA via da proposta.
 *
 * - `completa`  → dados enriquecidos, `via_reduzida = false`. É o que o
 *   proponente assina.
 * - `reduzida`  → idem, mas com os `hiddenPaths` DELETADOS e
 *   `via_reduzida = true`. É o que o proprietário/locador assina. O template usa
 *   `via_reduzida` pra imprimir a cláusula de "extrato" (§ frase obrigatória).
 *
 * `hiddenPaths` é re-sanitizado aqui contra a allowlist do schemaType — defesa
 * em profundidade, mesmo que a rota já tenha sanitizado na escrita.
 */
export function buildViaContext(input: {
  schemaType: string;
  dataJson: Record<string, unknown>;
  hiddenPaths: string[];
  via: ProposalVia;
  numero: string | number;
  /** Comissão é opcional na proposta. Só entra no documento quando true. */
  comissaoIncluida?: boolean;
  /**
   * Metadados da proposta que templates podem imprimir: `data_emissao`
   * (createdAt) e `validade_ate` (validUntil) — sem eles o texto de validade
   * era fixo ("7 dias") e divergia do prazo real escolhido no form. Entram no
   * contexto já FORMATADOS "dd/mm/aaaa" no fuso de São Paulo (formatDateBR):
   * `{{dataExtenso}}` no template usaria o fuso do PROCESSO e o validUntil
   * (23:59 BRT) deslizaria pro dia seguinte na Vercel (UTC). Opcionais:
   * templates testam com `{{#if}}`.
   */
  meta?: {
    emitidaEm?: Date | string | null;
    validaAte?: Date | string | null;
  };
}): Record<string, unknown> {
  let ctx = enrichForSchema(input.schemaType, input.dataJson);
  ctx.numero_proposta = input.numero;
  if (input.meta?.emitidaEm) ctx.data_emissao = formatDateBR(input.meta.emitidaEm, "");
  if (input.meta?.validaAte) ctx.validade_ate = formatDateBR(input.meta.validaAte, "");

  // `enrichContractData` sempre materializa `comissao` (mesmo vazia). Se a
  // comissão não foi incluída, tira o bloco do contexto.
  if (input.comissaoIncluida !== true) {
    ctx = unsetByPath(ctx, "comissao");
  }

  if (input.via === "reduzida") {
    const paths = sanitizeHiddenPaths(input.schemaType, input.hiddenPaths);
    for (const p of paths) {
      ctx = unsetByPath(ctx, p);
    }
    ctx.via_reduzida = true;
  } else {
    ctx.via_reduzida = false;
  }

  // O flag que o template testa (`{{#if comissao_incluida}}`) é recalculado
  // DEPOIS das remoções: a via reduzida pode ter escondido `comissao`, e aí o
  // header de intermediação não pode renderizar vazio. Fonte de verdade = a
  // comissão ainda estar no contexto.
  ctx.comissao_incluida = "comissao" in ctx;
  return ctx;
}

/** Renderiza o HTML de uma via a partir do source do template. */
export function renderProposalVia(input: {
  templateSource: string;
  schemaType: string;
  dataJson: Record<string, unknown>;
  hiddenPaths: string[];
  via: ProposalVia;
  numero: string | number;
  comissaoIncluida?: boolean;
  meta?: {
    emitidaEm?: Date | string | null;
    validaAte?: Date | string | null;
  };
}): string {
  const ctx = buildViaContext(input);
  return renderContratoHTML(input.templateSource, ctx);
}
