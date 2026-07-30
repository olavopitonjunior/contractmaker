/**
 * Teste de HIDRATAÇÃO REAL do breadcrumb do header.
 *
 * O bug que ele trava (produção, 2026-07-30): o header renderizava
 * `<BreadcrumbSeparator>` DENTRO de `<BreadcrumbItem>`. Os dois são `<li>` —
 * então o HTML do servidor saía com `<li>` aninhado em `<li>`, que é inválido.
 * O parser de HTML do browser aplica a regra do HTML5 e FECHA o `<li>` aberto ao
 * ver o próximo: o DOM que o browser monta tem os dois como IRMÃOS, não
 * aninhados. O React então procura o `<li>` do separador dentro do item, não
 * acha, e aborta a hidratação — React #418 por segmento intermediário e, no
 * fim, #423 (a raiz inteira re-renderiza no client).
 *
 * Por isso só aparecia em rota ANINHADA: `/corretores` tem um único segmento
 * (que é `isLast` e não emite separador) e o console ficava limpo, enquanto
 * `/pipeline/propostas/<id>` tem três e quebrava.
 *
 * O teste faz o ciclo de verdade: `renderToString` → `innerHTML` (que é onde o
 * parser desfaz o aninhamento) → `hydrateRoot`.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";

let pathname = "/";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// Vizinhos do breadcrumb no header: dependem de contexto de sidebar, tema e
// polling de notificações — ruído pro que está sob teste, que é a ÁRVORE do
// breadcrumb. Trocados por marcadores inertes.
vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: (p: Record<string, unknown>) => <button type="button" {...p} />,
}));
vi.mock("@/components/layout/command-palette", () => ({ CommandTrigger: () => <span /> }));
vi.mock("@/components/layout/theme-toggle", () => ({ ThemeToggle: () => <span /> }));
vi.mock("@/components/layout/NotificationsBell", () => ({ NotificationsBell: () => <span /> }));

import { DashboardHeader } from "../dashboard-header";

async function hydrateAndCollect(element: React.ReactElement) {
  const recoverable: string[] = [];
  const consoleErrors: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    consoleErrors.push(args.map((a) => String(a)).join(" "));
  };

  let container: HTMLDivElement | null = null;
  try {
    const serverHtml = renderToString(element);
    container = document.createElement("div");
    // É AQUI que o bug se materializa: atribuir a string ao innerHTML roda o
    // parser de HTML, o mesmo que o browser usa no documento da Vercel.
    container.innerHTML = serverHtml;
    document.body.appendChild(container);

    await act(async () => {
      hydrateRoot(container!, element, {
        onRecoverableError: (err) =>
          recoverable.push(err instanceof Error ? err.message : String(err)),
      });
    });
  } finally {
    console.error = originalError;
    container?.remove();
  }

  const isMismatch = (m: string) =>
    /hydrat|did not match|does not match|server (?:HTML|rendered)/i.test(m);
  return {
    recoverable,
    consoleErrors: [...new Set(consoleErrors.filter(isMismatch).map((m) => m.split("\n")[0]))],
  };
}

/** Maior profundidade de `<li>` aberto ao mesmo tempo na string de markup. */
function maxLiDepth(html: string): number {
  let depth = 0;
  let max = 0;
  for (const m of html.matchAll(/<(\/?)li[\s>]/gi)) {
    if (m[1]) depth = Math.max(0, depth - 1);
    else max = Math.max(max, ++depth);
  }
  return max;
}

describe("DashboardHeader — hidratação do breadcrumb", () => {
  const originalError = console.error;
  beforeEach(() => {
    pathname = "/";
  });
  afterEach(() => {
    console.error = originalError;
    vi.clearAllMocks();
  });

  it.each([
    ["/corretores", 1],
    ["/pipeline/propostas/cm9xk2p0000abcdefghijkl", 3],
    ["/deals/cm9xk2p0000abcdefghijkl", 2],
    ["/settings/integracoes", 2],
    ["/locacao/pessoas/clientes", 3],
  ])("hidrata %s sem mismatch", async (path) => {
    pathname = path;
    const report = await hydrateAndCollect(<DashboardHeader />);
    expect(report.consoleErrors).toEqual([]);
    expect(report.recoverable).toEqual([]);
  });

  it.each([
    "/corretores",
    "/pipeline/propostas/cm9xk2p0000abcdefghijkl",
    "/deals/cm9xk2p0000abcdefghijkl",
    "/locacao/pessoas/clientes",
  ])("não serializa <li> dentro de <li> em %s", (path) => {
    pathname = path;
    // Inspeciona a STRING do servidor, não o DOM: jogar o HTML num `innerHTML`
    // já roda o parser, que desfaz o aninhamento — um `querySelectorAll("li li")`
    // daria zero mesmo com o bug presente. Quem precisa estar correto é o que a
    // Vercel manda pro browser.
    expect(maxLiDepth(renderToString(<DashboardHeader />))).toBeLessThanOrEqual(1);
  });

  it("mantém o breadcrumb: rótulos, ids viram 'Detalhe' e o último não é link", () => {
    pathname = "/pipeline/propostas/cm9xk2p0000abcdefghijkl";
    const container = document.createElement("div");
    container.innerHTML = renderToString(<DashboardHeader />);

    const text = container.textContent ?? "";
    expect(text).toContain("Início");
    expect(text).toContain("Pipeline");
    expect(text).toContain("Propostas");
    expect(text).toContain("Detalhe");

    // Segmentos intermediários continuam navegáveis…
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/pipeline");
    expect(hrefs).toContain("/pipeline/propostas");
    // …e o último (o id) não vira link.
    expect(hrefs).not.toContain("/pipeline/propostas/cm9xk2p0000abcdefghijkl");
  });
});
