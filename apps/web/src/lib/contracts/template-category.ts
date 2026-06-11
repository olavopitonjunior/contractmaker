/**
 * Seleção determinística de template por categoria (forma de pagamento →
 * template), sem heurística/agente. A composição de `pagamento.parcelas[].tipo`
 * mapeia para uma categoria; a categoria puxa o template correspondente; se
 * não houver template da categoria, cai no PRINCIPAL DO GRUPO.
 *
 *   Grupo "sem alienação fiduciária" (modalidade a_vista):
 *     compra_e_venda · permuta · outros
 *   Grupo "com alienação fiduciária" (modalidade financiamento):
 *     financiamento · fgts · consorcio
 */
import type { ContractTemplate } from "@prisma/client";
// `prisma` é importado de forma lazy dentro de selectTemplateForDeal pra manter
// este módulo client-safe (as constantes/labels são usadas na UI de templates).

export const TEMPLATE_CATEGORIES = [
  "compra_e_venda",
  "permuta",
  "outros",
  "financiamento",
  "fgts",
  "consorcio",
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export type TemplateGroup = "sem_alienacao" | "com_alienacao";

export const CATEGORY_TO_GROUP: Record<TemplateCategory, TemplateGroup> = {
  compra_e_venda: "sem_alienacao",
  permuta: "sem_alienacao",
  outros: "sem_alienacao",
  financiamento: "com_alienacao",
  fgts: "com_alienacao",
  consorcio: "com_alienacao",
};

export const GROUP_TO_MODALIDADE: Record<TemplateGroup, "a_vista" | "financiamento"> = {
  sem_alienacao: "a_vista",
  com_alienacao: "financiamento",
};

export const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  compra_e_venda: "Contrato de compra e venda",
  permuta: "Com permuta",
  outros: "Outros tipos",
  financiamento: "Contrato de financiamento",
  fgts: "Fundo de garantia (FGTS)",
  consorcio: "Consórcio",
};

export const GROUP_LABELS: Record<TemplateGroup, string> = {
  sem_alienacao: "Sem alienação fiduciária",
  com_alienacao: "Com alienação fiduciária",
};

export function isTemplateCategory(v: unknown): v is TemplateCategory {
  return typeof v === "string" && (TEMPLATE_CATEGORIES as readonly string[]).includes(v);
}

export function modalidadeForCategory(category: TemplateCategory): "a_vista" | "financiamento" {
  return GROUP_TO_MODALIDADE[CATEGORY_TO_GROUP[category]];
}

/**
 * Deriva a categoria a partir da composição de parcelas do pagamento.
 * Prioridade (uma parcela pode ter vários tipos no mesmo negócio):
 *   consórcio > financiamento > FGTS > permuta > outros > compra e venda.
 * FGTS isolado → fgts; FGTS junto com financiamento → financiamento
 * (FGTS é fonte dentro do financiado).
 */
export function deriveCategoryFromPayment(dataJson: unknown): TemplateCategory {
  const data = (dataJson && typeof dataJson === "object" ? dataJson : {}) as {
    pagamento?: { parcelas?: Array<{ tipo?: unknown }>; banco_financiamento?: unknown };
  };
  const pagamento = data.pagamento ?? {};
  const tipos = new Set(
    (pagamento.parcelas ?? [])
      .map((p) => (typeof p?.tipo === "string" ? p.tipo : ""))
      .filter(Boolean)
  );
  const hasBanco =
    typeof pagamento.banco_financiamento === "string" &&
    pagamento.banco_financiamento.trim().length > 0;

  if (tipos.has("cessao_consorcio")) return "consorcio";
  if (tipos.has("financiamento") || hasBanco) return "financiamento";
  if (tipos.has("fgts")) return "fgts";
  if (tipos.has("permuta_veiculo") || tipos.has("permuta_imovel")) return "permuta";
  if (tipos.has("outros")) return "outros";
  return "compra_e_venda";
}

export interface TemplateLite {
  id: string;
  category: string | null;
  modalidade: string | null;
  isDefault: boolean;
  status: string;
}

/**
 * Resolver puro (testável): escolhe o template para a categoria seguindo
 *   1) match exato de categoria (preferindo isDefault),
 *   2) PRINCIPAL DO GRUPO (template isDefault da mesma modalidade/grupo),
 *   3) default geral da org.
 * Retorna o id escolhido ou null. Ex.: consórcio sem template → principal de
 * "com alienação fiduciária" (= financiamento).
 */
export function resolveTemplateId(
  category: TemplateCategory,
  templates: TemplateLite[]
): string | null {
  const active = templates.filter((t) => t.status === "active");
  if (active.length === 0) return null;

  const byCat = active.filter((t) => t.category === category);
  if (byCat.length) return (byCat.find((t) => t.isDefault) ?? byCat[0]).id;

  const modal = modalidadeForCategory(category);
  const byGroup = active.filter((t) => (t.modalidade ?? "a_vista") === modal);
  const groupPrincipal = byGroup.find((t) => t.isDefault) ?? byGroup[0];
  if (groupPrincipal) return groupPrincipal.id;

  return (active.find((t) => t.isDefault) ?? active[0]).id;
}

/**
 * Seleção determinística para um deal: categoria ← pagamento, template ←
 * resolveTemplateId. Retorna o template completo + a categoria resolvida.
 */
export async function selectTemplateForDeal(
  orgId: string,
  dataJson: unknown
): Promise<{ template: ContractTemplate; category: TemplateCategory } | null> {
  const category = deriveCategoryFromPayment(dataJson);
  const { prisma } = await import("@/lib/db/prisma");
  const templates = await prisma.contractTemplate.findMany({
    where: { orgId, status: "active" },
  });
  if (templates.length === 0) return null;
  const chosenId = resolveTemplateId(
    category,
    templates.map((t) => ({
      id: t.id,
      category: t.category,
      modalidade: t.modalidade,
      isDefault: t.isDefault,
      status: t.status,
    }))
  );
  const template = templates.find((t) => t.id === chosenId);
  return template ? { template, category } : null;
}

// ============================================================================
// Locação — seleção de template independente da heurística de pagamento de
// venda. O discriminador é o `schemaType` do form: residencial → modalidade
// "locacao"; comercial → "locacao_comercial" (modalidades distintas pra que o
// sync-templates não sobrescreva os dois arquivos). Preferimos isDefault.
// ============================================================================
export function modalidadeForLocacaoSchemaType(schemaType: string): string {
  return schemaType === "locacao_comercial_v1" ? "locacao_comercial" : "locacao";
}

export async function selectLocacaoTemplate(
  orgId: string,
  schemaType: string
): Promise<{ template: ContractTemplate } | null> {
  const modalidade = modalidadeForLocacaoSchemaType(schemaType);
  const { prisma } = await import("@/lib/db/prisma");
  const active = await prisma.contractTemplate.findMany({
    where: { orgId, status: "active" },
  });
  if (active.length === 0) return null;

  // 1) match exato da modalidade de locação (prefere isDefault)
  const exact = active.filter((t) => t.modalidade === modalidade);
  if (exact.length) return { template: exact.find((t) => t.isDefault) ?? exact[0] };

  // 2) fallback: qualquer template de locação ativo (modalidade começa com "locacao")
  const anyLocacao = active.filter((t) => (t.modalidade ?? "").startsWith("locacao"));
  if (anyLocacao.length) return { template: anyLocacao.find((t) => t.isDefault) ?? anyLocacao[0] };

  return null;
}
