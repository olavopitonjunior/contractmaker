/**
 * F1 catalog helpers — query the endpoint metadata declaratively.
 * Used by the planner (to pick which endpoints apply to a given deal) and
 * by the "+ Adicionar outras" picker UI (to list available endpoints with
 * filters by UF and category).
 *
 * All helpers return NEW arrays — safe to memoize at call sites.
 */
import {
  ENDPOINTS,
  type EndpointInfo,
  type EndpointScope,
  type EndpointCategory,
  type EndpointAppliesTo,
} from "./endpoints";

/**
 * Returns all endpoints in the catalog as a flat array. Excludes the
 * "obter-*" 2-step second-phase endpoints because those are only triggered
 * by the portal poller, never selected directly by the user.
 */
export function listAllForPicker(): EndpointInfo[] {
  return Object.values(ENDPOINTS).filter(
    (e) => e.initialStatus !== "awaiting_portal" && e.internalOnly !== true
  );
}

/**
 * Returns endpoints that apply to a given UF. Always includes federal
 * endpoints (which have no UF) since they apply everywhere. Passing null
 * returns only federal endpoints.
 */
export function listEndpointsByUf(uf: string | null): EndpointInfo[] {
  return listAllForPicker().filter((e) => {
    if (e.scope === "federal") return true;
    if (!uf) return false;
    return e.uf === uf.toUpperCase();
  });
}

/**
 * Returns endpoints in a given category, ordered by scope (federal first).
 */
export function listEndpointsByCategory(
  category: EndpointCategory
): EndpointInfo[] {
  const scopeOrder: Record<EndpointScope, number> = {
    federal: 0,
    estadual: 1,
    municipal: 2,
    serasa: 3,
    credito: 4,
  };
  return listAllForPicker()
    .filter((e) => e.category === category)
    .sort((a, b) => scopeOrder[a.scope] - scopeOrder[b.scope]);
}

/**
 * Returns endpoints that can be applied to a given target kind. Used by the
 * picker to hide imovel-only endpoints when the user is selecting for a
 * pessoa (and vice versa).
 */
export function listEndpointsForTarget(
  appliesTo: EndpointAppliesTo
): EndpointInfo[] {
  return listAllForPicker().filter((e) => e.appliesTo.includes(appliesTo));
}

/**
 * Groups endpoints by scope for the picker UI — returns 3 sections:
 * Federal, Estadual (with sub-groups by UF), Municipal (with sub-groups by UF).
 *
 * The optional `filterUf` restricts state/municipal groups to only that UF.
 * The optional `filterCategory` restricts to that category across all groups.
 */
export interface PickerGroup {
  scope: EndpointScope;
  label: string;
  uf?: string; // only for estadual/municipal
  endpoints: EndpointInfo[];
}

export function listEndpointsGrouped(options: {
  filterUf?: string | null;
  filterCategory?: EndpointCategory | null;
  filterTarget?: EndpointAppliesTo | null;
} = {}): PickerGroup[] {
  const { filterUf, filterCategory, filterTarget } = options;
  const all = listAllForPicker().filter((e) => {
    if (filterCategory && e.category !== filterCategory) return false;
    if (filterTarget && !e.appliesTo.includes(filterTarget)) return false;
    return true;
  });

  const groups: PickerGroup[] = [];

  // Federal — no UF filter applied
  const federal = all.filter((e) => e.scope === "federal");
  if (federal.length > 0) {
    groups.push({ scope: "federal", label: "Federal", endpoints: federal });
  }

  // Estadual — grouped by UF, optionally filtered
  const estadual = all.filter((e) => e.scope === "estadual");
  const estadualUfs = Array.from(new Set(estadual.map((e) => e.uf!))).sort();
  for (const uf of estadualUfs) {
    if (filterUf && uf !== filterUf.toUpperCase()) continue;
    groups.push({
      scope: "estadual",
      label: `Estadual ${uf}`,
      uf,
      endpoints: estadual.filter((e) => e.uf === uf),
    });
  }

  // Municipal — grouped by UF, optionally filtered
  const municipal = all.filter((e) => e.scope === "municipal");
  const municipalUfs = Array.from(new Set(municipal.map((e) => e.uf!))).sort();
  for (const uf of municipalUfs) {
    if (filterUf && uf !== filterUf.toUpperCase()) continue;
    groups.push({
      scope: "municipal",
      label: `Municipal ${uf}`,
      uf,
      endpoints: municipal.filter((e) => e.uf === uf),
    });
  }

  return groups;
}

/**
 * Returns the distinct UFs that have state or municipal endpoints in the
 * catalog. Used to populate the UF filter dropdown in the picker.
 */
export function listCoveredUfs(): string[] {
  const ufs = new Set<string>();
  for (const e of Object.values(ENDPOINTS)) {
    if (e.uf) ufs.add(e.uf);
  }
  return Array.from(ufs).sort();
}

/**
 * Returns the distinct categories in the catalog. Used by category chips
 * in the picker.
 */
export function listCoveredCategories(): EndpointCategory[] {
  const cats = new Set<EndpointCategory>();
  for (const e of Object.values(ENDPOINTS)) {
    cats.add(e.category);
  }
  // Deterministic order for UI consistency
  // `cadastro` (Receita CPF/CNPJ) e `fgts` (CRF) ficavam fora da ordem e por
  // isso nunca viravam chip no picker, embora existam no catálogo. Serasa
  // (score/negativacao/vinculos) continua fora: não está integrado.
  const order: EndpointCategory[] = [
    "federal",
    "cadastro",
    "civel",
    "trabalhista",
    "fiscal",
    "protesto",
    "fgts",
    "municipal",
    "registro",
  ];
  return order.filter((c) => cats.has(c));
}

export const CATEGORY_LABELS: Record<EndpointCategory, string> = {
  federal: "Federal",
  civel: "Cível",
  trabalhista: "Trabalhista",
  fiscal: "Fiscal",
  protesto: "Protesto",
  municipal: "Municipal",
  registro: "Registro de Imóveis",
  cadastro: "Cadastro",
  fgts: "FGTS",
  score: "Score",
  negativacao: "Negativação",
  vinculos: "Vínculos",
};
