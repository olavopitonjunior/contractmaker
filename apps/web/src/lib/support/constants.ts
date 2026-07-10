/**
 * Constantes do assistente de suporte ao usuário.
 *
 * A base de conhecimento de suporte reusa a tabela KnowledgeItem (pgvector) com
 * a categoria dedicada abaixo e um orgId de plataforma (ver ./org.ts). Diferente
 * das categorias de cláusula/legislação, que servem o editor de contrato.
 */

/** Categoria de KnowledgeItem da base de conhecimento do assistente de suporte. */
export const SUPPORT_CATEGORY = "support" as const;

/**
 * Tags de módulo aplicadas a cada item da base de suporte. "geral" vale pra
 * qualquer tenant; "vendas"/"locacao" só aparecem se o módulo estiver habilitado.
 * Todo item DEVE ter ao menos uma destas tags (o filtro de busca usa overlap).
 */
export const SUPPORT_MODULE_TAGS = ["geral", "vendas", "locacao"] as const;
export type SupportModuleTag = (typeof SUPPORT_MODULE_TAGS)[number];

export function isSupportModuleTag(v: string): v is SupportModuleTag {
  return (SUPPORT_MODULE_TAGS as readonly string[]).includes(v);
}

/** Chave singleton de SupportAgentConfig. */
export const SUPPORT_CONFIG_SINGLETON = "singleton";
