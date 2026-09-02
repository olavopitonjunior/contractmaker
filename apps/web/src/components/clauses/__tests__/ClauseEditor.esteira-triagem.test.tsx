/**
 * O balde de triagem precisa ter SAÍDA, inclusive em org sem locação (#480).
 *
 * A tela de revisão instrui: "abra a cláusula e defina a esteira à mão". Só que
 * o select de esteira era `disabled={!locacaoEnabled}` de forma incondicional —
 * numa org venda-only a instrução apontava para um campo travado, e a cláusula
 * não classificada não tinha nenhuma saída pela interface.
 *
 * A regra de produto continua valendo: org sem o módulo de locação fica em
 * venda. O que muda é que sair de "não classificada" PARA venda passa a ser
 * possível — o que essa regra já assume, e não contradiz.
 *
 * Hoje as 5 orgs de produção têm o módulo ligado, então isto é uma armadilha
 * armada para o primeiro tenant venda-only, não um incêndio.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClauseEditor } from "../ClauseEditor";
import type { Clause } from "../types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
// O preview busca o servidor; irrelevante para o estado do select.
vi.mock("../ClausePreviewFrame", () => ({
  ClausePreviewFrame: () => null,
}));

function clause(esteira: string | null): Clause {
  return {
    id: "c1",
    title: "Cláusula em triagem",
    content: "conteúdo",
    category: "outros",
    subcategory: "outros",
    groupCode: null,
    esteira,
    isVariable: false,
    agentNotes: null,
    tags: [],
    status: "approved",
    source: "manual",
    orgId: "org-1",
    usageCount: 0,
    orgUsageCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as Clause;
}

/**
 * O campo de esteira vive na aba "Metadados", que o Radix não monta enquanto
 * inativa — sem abrir a aba não há combobox nenhum na árvore.
 */
async function abrirMetadados() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: /Metadados/i }));
}

/** O combobox de Esteira, achado pelo valor que ele exibe. */
function selectDeEsteira(): HTMLElement {
  const combos = screen.getAllByRole("combobox");
  const alvo = combos.find((c) =>
    /Não classificada|Compra e venda|Locação|Comum às duas/i.test(
      c.textContent ?? ""
    )
  );
  if (!alvo) throw new Error("select de esteira não encontrado");
  return alvo;
}

describe("ClauseEditor — saída do balde de triagem (#480)", () => {
  it("org SEM locação: cláusula não classificada pode receber esteira", async () => {
    render(
      <ClauseEditor
        clause={clause(null)}
        open
        onClose={() => {}}
        mode="edit"
        locacaoEnabled={false}
      />
    );

    await abrirMetadados();
    expect(selectDeEsteira()).not.toBeDisabled();
  });

  /**
   * CONTROLE. Sem ele, simplesmente apagar o `disabled` passaria no teste acima
   * e desfaria a regra do módulo: uma org venda-only voltaria a poder mover
   * cláusula para locação.
   */
  it("org SEM locação: cláusula JÁ classificada continua travada", async () => {
    render(
      <ClauseEditor
        clause={clause("venda")}
        open
        onClose={() => {}}
        mode="edit"
        locacaoEnabled={false}
      />
    );

    await abrirMetadados();
    expect(selectDeEsteira()).toBeDisabled();
  });

  it("org COM locação: o select nunca fica travado", async () => {
    render(
      <ClauseEditor
        clause={clause("venda")}
        open
        onClose={() => {}}
        mode="edit"
        locacaoEnabled
      />
    );

    await abrirMetadados();
    expect(selectDeEsteira()).not.toBeDisabled();
  });
});
