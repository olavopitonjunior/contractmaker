/**
 * Trocar de esteira limpa a seleção em lote (issue #479).
 *
 * Reproduzido em staging: marcar a cláusula em Vendas, clicar na aba Locação e
 * marcar as 15 visíveis exibia "16 selecionada(s)". O 16º era a cláusula de
 * venda, ainda no `Set` e sem checkbox visível — e o "Analisar e classificar"
 * a mandava junto, levando à revisão uma proposta que o usuário não pediu,
 * sobre um item que ele não conseguia ver.
 *
 * O teste clica onde o usuário clicou: no `role="tab"` do EsteiraSwitch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClausesPageClient } from "../ClausesPageClient";
import type { Clause } from "../types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

function clause(over: Partial<Clause> & Pick<Clause, "id" | "esteira">): Clause {
  return {
    title: `Cláusula ${over.id}`,
    content: "conteúdo",
    category: "outros",
    subcategory: "outros",
    groupCode: null,
    isVariable: false,
    agentNotes: null,
    tags: [],
    status: "approved",
    source: "manual",
    // Não-null: cláusula de PLATAFORMA é ignorada por `selectMany`, e o teste
    // ficaria verde por não conseguir selecionar nada.
    orgId: "org-1",
    usageCount: 0,
    orgUsageCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  } as Clause;
}

const CLAUSULAS: Clause[] = [
  clause({ id: "v1", esteira: "venda", groupCode: "G1", title: "Sinal e arras" }),
  clause({ id: "l1", esteira: "locacao", title: "Garantia locatícia" }),
  clause({ id: "l2", esteira: "locacao", title: "Reajuste e índice" }),
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ClausesPageClient — seleção não atravessa a esteira (#479)", () => {
  it("limpa a seleção ao trocar de esteira", async () => {
    const user = userEvent.setup();
    render(<ClausesPageClient clauses={CLAUSULAS} locacaoEnabled />);

    // Por nome, não por índice: há também um checkbox de "selecionar todas" no
    // cabeçalho de cada grupo, e mirar pelo índice pegaria o errado.
    await user.click(screen.getByLabelText("Selecionar Sinal e arras"));
    expect(screen.getByText(/1 selecionada\(s\)/)).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: /Locação/ }));

    // A barra de seleção só existe quando há item marcado: sumir É o contrato.
    expect(screen.queryByText(/selecionada\(s\)/)).toBeNull();
  });

  // O contador mentindo é o sintoma que o usuário vê. Sem esta asserção, uma
  // limpeza parcial (que zerasse a barra mas não o Set) passaria.
  it("depois da troca, marcar tudo conta só o que está visível", async () => {
    const user = userEvent.setup();
    render(<ClausesPageClient clauses={CLAUSULAS} locacaoEnabled />);

    await user.click(screen.getByLabelText("Selecionar Sinal e arras"));
    await user.click(screen.getByRole("tab", { name: /Locação/ }));

    await user.click(screen.getByLabelText("Selecionar Garantia locatícia"));
    await user.click(screen.getByLabelText("Selecionar Reajuste e índice"));

    // 2 de locação. Se a de venda tivesse sobrevivido, seriam 3.
    expect(screen.getByText(/2 selecionada\(s\)/)).toBeTruthy();
  });

  it("volta para a esteira de origem sem seleção pendurada", async () => {
    const user = userEvent.setup();
    render(<ClausesPageClient clauses={CLAUSULAS} locacaoEnabled />);

    await user.click(screen.getByLabelText("Selecionar Sinal e arras"));
    await user.click(screen.getByRole("tab", { name: /Locação/ }));
    await user.click(screen.getByRole("tab", { name: /Vendas/ }));

    expect(screen.queryByText(/selecionada\(s\)/)).toBeNull();
  });
});
