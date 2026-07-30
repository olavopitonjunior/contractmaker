/**
 * Catálogo canônico de templates Handlebars — FONTE ÚNICA dos metadados.
 *
 * Consumido por:
 *   - `lib/templates/canonical-seed.ts` (seed por org: criação de tenant, CLI)
 *   - `scripts/sync-templates.ts` (update de conteúdo `--apply`)
 *   - `scripts/generate-canonical-template-sources.ts` (codegen do conteúdo)
 *
 * Módulo sem dependências (nem alias `@/`, nem prisma) de propósito: scripts
 * tsx e o codegen importam por caminho relativo.
 */

export type CanonicalModalidade =
  // "administracao_locacao" deliberadamente NÃO começa com "locacao" — o
  // fallback de selectLocacaoTemplate casa startsWith("locacao") e pegaria o
  // contrato de administração como template de locação.
  | "a_vista"
  | "financiamento"
  | "locacao"
  | "locacao_comercial"
  | "administracao_locacao"
  | "proposta_venda"
  | "proposta_locacao_residencial"
  | "proposta_locacao_comercial";

export interface CanonicalTemplate {
  modalidade: CanonicalModalidade;
  /** Arquivo em `templates/` na RAIZ do repo. */
  filename: string;
  canonicalName: string;
  canonicalDescription: string;
  /** schemaType da row criada no seed. Default: `DEFAULT_SCHEMA_TYPE`. */
  schemaType?: string;
}

/** schemaType das modalidades de venda, que não declaram um explícito. */
export const DEFAULT_SCHEMA_TYPE = "compra_venda_v2";

export const CANONICAL_TEMPLATES: CanonicalTemplate[] = [
  {
    modalidade: "a_vista",
    filename: "ccv_a_vista_v2.hbs",
    canonicalName: "CCV - Pagamento À Vista",
    canonicalDescription:
      "Instrumento particular de compromisso de venda e compra - modalidade pagamento à vista",
  },
  {
    modalidade: "financiamento",
    filename: "ccv_financiamento_v2.hbs",
    canonicalName: "CCV - Financiamento Imobiliário",
    canonicalDescription:
      "Instrumento particular de compromisso de venda e compra - modalidade financiamento imobiliário",
  },
  {
    modalidade: "locacao",
    filename: "locacao_residencial_v3.hbs",
    canonicalName: "Locação Residencial",
    canonicalDescription:
      "Instrumento particular de contrato de locação residencial com administração - Lei nº 8.245/91",
    schemaType: "locacao_residencial_v1",
  },
  {
    modalidade: "locacao_comercial",
    filename: "locacao_comercial_v3.hbs",
    canonicalName: "Locação Comercial",
    canonicalDescription:
      "Instrumento particular de contrato de locação não residencial (comercial) com administração - Lei nº 8.245/91",
    schemaType: "locacao_comercial_v1",
  },
  {
    modalidade: "administracao_locacao",
    filename: "administracao_locacao_v1.hbs",
    canonicalName: "Administração de Locação",
    canonicalDescription:
      "Instrumento particular de contrato de administração de locação de imóvel (imobiliária ↔ proprietário) - CC arts. 653-666 e Lei nº 8.245/91",
    schemaType: "administracao_locacao_v1",
  },
  // Propostas comerciais (oferta pré-contrato). schemaType igual ao do contrato
  // correspondente — a conversão herda o dataJson sem tradução.
  {
    modalidade: "proposta_venda",
    filename: "proposta_venda_v1.hbs",
    canonicalName: "Proposta de Compra",
    canonicalDescription:
      "Proposta de compra de imóvel (oferta do proponente antes do contrato)",
    schemaType: "compra_venda_v1",
  },
  {
    modalidade: "proposta_locacao_residencial",
    filename: "proposta_locacao_residencial_v1.hbs",
    canonicalName: "Proposta de Locação Residencial",
    canonicalDescription:
      "Proposta de locação residencial (oferta do proponente antes do contrato)",
    schemaType: "locacao_residencial_v1",
  },
  {
    modalidade: "proposta_locacao_comercial",
    filename: "proposta_locacao_comercial_v1.hbs",
    canonicalName: "Proposta de Locação Comercial",
    canonicalDescription:
      "Proposta de locação não residencial/comercial (oferta do proponente antes do contrato)",
    schemaType: "locacao_comercial_v1",
  },
];

/** Nomes dos arquivos `.hbs` que o codegen precisa embarcar. */
export const CANONICAL_TEMPLATE_FILENAMES: string[] = CANONICAL_TEMPLATES.map(
  (t) => t.filename
);

/**
 * Modalidades canônicas de cada MÓDULO habilitável do tenant (as chaves são as
 * de `lib/modules/catalog.ts`, referenciadas por string pra este arquivo seguir
 * sem dependências).
 *
 * Existe porque o seed semeava as 8 modalidades pra todo tenant — inclusive um
 * só-locação, que ganhava CCV à vista/financiamento contradizendo as próprias
 * rows de `OrgModule` escritas na mesma request.
 */
export const CANONICAL_MODALIDADES_BY_MODULE: Record<string, CanonicalModalidade[]> = {
  vendas: ["a_vista", "financiamento", "proposta_venda"],
  locacao: [
    "locacao",
    "locacao_comercial",
    "administracao_locacao",
    "proposta_locacao_residencial",
    "proposta_locacao_comercial",
  ],
};

/**
 * União das modalidades dos módulos informados, na ordem do catálogo canônico.
 *
 * Lista vazia devolve lista VAZIA (nada a semear), NÃO "todas": quem quiser o
 * comportamento legado "org sem entitlements ganha tudo" decide isso no call
 * site (é o que `sync-templates --seed` faz pra org anterior à modularização).
 * Devolver tudo aqui faria um tenant com todos os módulos DESLIGADOS receber as
 * 8 modalidades — exatamente o bug que este helper existe pra fechar.
 */
export function canonicalModalidadesForModules(
  modules: readonly string[]
): CanonicalModalidade[] {
  const wanted = new Set<string>();
  for (const m of modules) {
    for (const mod of CANONICAL_MODALIDADES_BY_MODULE[m] ?? []) wanted.add(mod);
  }
  return CANONICAL_TEMPLATES.filter((t) => wanted.has(t.modalidade)).map(
    (t) => t.modalidade
  );
}
