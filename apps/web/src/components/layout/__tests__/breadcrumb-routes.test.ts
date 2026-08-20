import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  DEAD_SEGMENT_HREFS,
  DEAD_ID_PARENT_HREFS,
  isDeadCrumb,
} from "../breadcrumb-routes";

/**
 * A whitelist de crumbs mortos é estática (o header é client component e não
 * anda no filesystem), então ESTE teste é quem a mantém honesta: deriva do
 * app/(dashboard) real quais segmentos intermediários não têm page.tsx,
 * SUBTRAI os cobertos por redirect do next.config.js (link de crumb
 * redirecionado navega com sucesso — /deals e /locacao/deals, PR #319) e
 * exige igualdade exata. Criou page.tsx ou redirect num segmento listado? O
 * teste manda remover a entrada. Nasceu segmento morto fora da lista? Quebra
 * antes de o 404 chegar no breadcrumb (issue #320).
 */

const WEB_ROOT = path.join(__dirname, "../../../..");
const DASHBOARD_DIR = path.join(WEB_ROOT, "src/app/(dashboard)");

function hasPage(dir: string): boolean {
  if (
    ["page.tsx", "page.jsx", "page.ts", "page.js"].some((f) =>
      fs.existsSync(path.join(dir, f))
    )
  ) {
    return true;
  }
  // Route group serve a MESMA URL do dir pai: page.tsx em (grupo)/ conta como
  // página do pai (ex.: locacao/(adm)/page.tsx responde por /locacao).
  return fs.readdirSync(dir, { withFileTypes: true }).some(
    (e) =>
      e.isDirectory() &&
      isRouteGroup(e.name) &&
      !isInterceptingRoute(e.name) &&
      hasPage(path.join(dir, e.name))
  );
}

function isRouteGroup(name: string): boolean {
  return name.startsWith("(") && name.endsWith(")");
}

// Intercepting routes ((.)x, (..)x, (...)x) são overlays de outra rota, não
// segmentos de URL — o walker as ignora por completo.
function isInterceptingRoute(name: string): boolean {
  return /^\(\.{1,3}\)/.test(name);
}

function isDynamic(name: string): boolean {
  return name.startsWith("[") && name.endsWith("]");
}

interface Walked {
  /** hrefs de dirs ESTÁTICOS sem page.tsx que têm alguma página descendente. */
  deadStatic: Set<string>;
  /** hrefs dos PAIS de dirs dinâmicos sem page.tsx com página descendente. */
  deadIdParents: Set<string>;
}

function walk(
  dir: string,
  urlParts: string[],
  acc: Walked
): boolean /* subtree contém página? */ {
  let subtreeHasPage = hasPage(dir);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("_") || entry.name.startsWith("@")) continue;
    if (isInterceptingRoute(entry.name)) continue;
    const child = path.join(dir, entry.name);
    // Route group não vira segmento de URL.
    const childParts = isRouteGroup(entry.name)
      ? urlParts
      : [...urlParts, entry.name];
    const childHasDescendantPage = walk(child, childParts, acc);
    if (!childHasDescendantPage) continue;
    subtreeHasPage = true;
    if (isRouteGroup(entry.name) || hasPage(child)) continue;
    // Dir sem page.tsx mas com página descendente = crumb intermediário morto.
    if (isDynamic(entry.name)) {
      acc.deadIdParents.add("/" + urlParts.join("/"));
    } else {
      acc.deadStatic.add("/" + childParts.join("/"));
    }
  }
  return subtreeHasPage;
}

/** Sources exatos + bases de padrões `/:path*` dos redirects do next.config. */
async function redirectCoveredHrefs(): Promise<Set<string>> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nextConfig = require(path.join(WEB_ROOT, "next.config.js"));
  const rules: Array<{ source: string }> = await nextConfig.redirects();
  const covered = new Set<string>();
  for (const r of rules) {
    covered.add(r.source);
    const base = r.source.replace(/\/:path\*$/, "");
    if (base) covered.add(base);
  }
  return covered;
}

describe("breadcrumb-routes — whitelist derivada do filesystem", () => {
  const acc: Walked = { deadStatic: new Set(), deadIdParents: new Set() };
  walk(DASHBOARD_DIR, [], acc);

  it("nenhum dir estático morto sob segmento dinâmico (classe não suportada)", () => {
    // "/forms/[id]/docs" viraria href com colchetes literais, que nunca casa
    // com pathname real — o mecanismo de whitelist NÃO cobre essa classe. Se
    // este teste falhar, não adicione a entrada: crie page.tsx no dir ou
    // troque o mecanismo (ex.: matcher por padrão em breadcrumb-routes.ts).
    const comColchetes = [...acc.deadStatic].filter((h) => h.includes("["));
    expect(comColchetes).toEqual([]);
  });

  it("DEAD_SEGMENT_HREFS = dirs estáticos sem page.tsx MENOS redirects", async () => {
    const covered = await redirectCoveredHrefs();
    const expected = [...acc.deadStatic].filter((h) => !covered.has(h)).sort();
    expect(expected).toEqual([...DEAD_SEGMENT_HREFS].sort());
    // Sanidade da subtração: os dois casos do PR #319 são mortos no fs porém
    // cobertos por redirect — não podem estar na whitelist.
    expect(acc.deadStatic.has("/deals")).toBe(true);
    expect(covered.has("/deals")).toBe(true);
    expect(DEAD_SEGMENT_HREFS.has("/deals")).toBe(false);
  });

  it("DEAD_ID_PARENT_HREFS espelha exatamente os pais de [id] sem page.tsx", () => {
    expect([...acc.deadIdParents].sort()).toEqual(
      [...DEAD_ID_PARENT_HREFS].sort()
    );
  });

  it("isDeadCrumb: casos representativos", () => {
    // /deals é morto no fs mas o redirect mantém o link navegável.
    expect(isDeadCrumb("/deals", false, "/")).toBe(false);
    expect(isDeadCrumb("/locacao/deals", false, "/locacao")).toBe(false);
    expect(isDeadCrumb("/certidoes", false, "/")).toBe(true);
    expect(isDeadCrumb("/settings/pagamentos", false, "/settings")).toBe(true);
    expect(isDeadCrumb("/pipeline", false, "/")).toBe(false);
    // /deals/[id] existe e renderiza — crumb de id sob /deals é link.
    expect(isDeadCrumb("/deals/cmsz01o1w0006gh050l1c3kzv", true, "/deals")).toBe(
      false
    );
    // /forms/[id] não tem página (só /share) — crumb de id sob /forms é texto.
    expect(isDeadCrumb("/forms/cmsz01o1q0003gh05tjj8eh38", true, "/forms")).toBe(
      true
    );
  });
});
