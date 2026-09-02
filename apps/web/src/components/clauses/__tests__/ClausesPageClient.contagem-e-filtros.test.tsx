/**
 * Duas mentiras da tela de cláusulas, da mesma família (issues #480 e #484):
 * o número não corresponde à lista, e a seleção não corresponde ao que está
 * visível. Nos dois casos o usuário decide com base num número errado.
 *
 * - #480: `esteiraCounts` implementava a regra de visibilidade uma segunda vez
 *   e esqueceu das cláusulas SEM esteira. A aba dizia "Locação (23)" enquanto a
 *   lista mostrava 24 linhas — e o item que sumia do número era justamente o
 *   não triado.
 * - #484: o `Set` da seleção sobrevive a qualquer filtro que esconda uma linha.
 *   A barra dizia "1 selecionada(s)" sem nenhum checkbox marcado, e "Analisar e
 *   classificar" mandava esse id.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
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
    // Não-null: cláusula de PLATAFORMA é ignorada por `selectMany`.
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
  clause({ id: "amb", esteira: "ambas", title: "Foro de eleição" }),
  clause({ id: "n1", esteira: null, title: "Cláusula sem triagem" }),
];

/** Número que a aba exibe entre parênteses. */
function contagemDaAba(nome: RegExp): number {
  const tab = screen.getByRole("tab", { name: nome });
  const m = tab.textContent?.match(/\((\d+)\)/);
  if (!m) throw new Error(`aba sem contagem: ${tab.textContent}`);
  return Number(m[1]);
}

/**
 * Linhas de cláusula visíveis. Exclui o "Selecionar todas de <grupo>" do
 * cabeçalho de cada seção, que também casa com /^Selecionar /.
 */
function linhasVisiveis(): number {
  return screen
    .getAllByLabelText(/^Selecionar /)
    .filter((el) => !/^Selecionar todas de /.test(el.getAttribute("aria-label") ?? ""))
    .length;
}

/**
 * O botão "Analisar e classificar" da BARRA de seleção. Existe um homônimo no
 * cabeçalho de cada seção (e outro no detalhe da cláusula); mirar por texto
 * global pega o errado.
 */
function analisarDaBarra(): HTMLElement {
  const barra = screen.getByText(/selecionada\(s\)/).parentElement;
  if (!barra) throw new Error("barra de seleção não encontrada");
  return within(barra).getByRole("button", { name: /Analisar e classificar/i });
}

/**
 * O Select do Radix usa Pointer Capture, que o jsdom não implementa. Sem estes
 * stubs o trigger não abre e o filtro de GRUPO — o único contrato que exige
 * dirigir um Select — ficaria sem teste.
 */
beforeAll(() => {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture = vi.fn(() => false);
  proto.setPointerCapture = vi.fn();
  proto.releasePointerCapture = vi.fn();
  proto.scrollIntoView = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("contagem da aba × lista (#480)", () => {
  /**
   * O contrato é a IGUALDADE, não um número mágico: a contagem tem de bater com
   * o que a lista mostra. Asserção sobre um literal passaria mesmo se as duas
   * pontas derivassem de regras diferentes — que é exatamente o bug.
   */
  it("conta a cláusula SEM esteira, como a lista faz — nas duas abas", async () => {
    const user = userEvent.setup();
    render(<ClausesPageClient clauses={CLAUSULAS} locacaoEnabled />);

    // Vendas: v1 + ambas + sem esteira = 3
    expect(contagemDaAba(/Vendas/)).toBe(linhasVisiveis());
    expect(contagemDaAba(/Vendas/)).toBe(3);

    await user.click(screen.getByRole("tab", { name: /Locação/ }));

    // Locação: l1 + ambas + sem esteira = 3
    expect(contagemDaAba(/Locação/)).toBe(linhasVisiveis());
    expect(contagemDaAba(/Locação/)).toBe(3);
  });

  it("a cláusula sem esteira aparece nas DUAS abas", async () => {
    const user = userEvent.setup();
    render(<ClausesPageClient clauses={CLAUSULAS} locacaoEnabled />);

    expect(screen.getByLabelText("Selecionar Cláusula sem triagem")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: /Locação/ }));
    expect(screen.getByLabelText("Selecionar Cláusula sem triagem")).toBeTruthy();
  });
});

describe("seleção só conta o que está visível (#484)", () => {
  it("filtro que esconde a linha tira o item da contagem", async () => {
    const user = userEvent.setup();
    render(<ClausesPageClient clauses={CLAUSULAS} locacaoEnabled />);

    await user.click(screen.getByLabelText("Selecionar Sinal e arras"));
    expect(screen.getByText(/1 selecionada\(s\)/)).toBeTruthy();

    // A busca esconde a linha marcada. Antes disto a barra continuava
    // "1 selecionada(s)" com nenhum checkbox marcado na tela.
    await user.type(screen.getByPlaceholderText(/Buscar/i), "Foro");

    expect(screen.queryByText(/selecionada\(s\)/)).toBeNull();
  });

  /**
   * CONTROLE, e é o que separa "interseção" de "consertar demais": a seleção
   * NÃO é apagada, só deixa de contar enquanto está escondida. Uma correção que
   * zerasse o `Set` a cada mudança de filtro passaria no teste acima e violaria
   * este — que é o contrato documentado na própria #484.
   */
  it("limpar o filtro traz a seleção de volta — o Set não foi apagado", async () => {
    const user = userEvent.setup();
    render(<ClausesPageClient clauses={CLAUSULAS} locacaoEnabled />);

    await user.click(screen.getByLabelText("Selecionar Sinal e arras"));
    const busca = screen.getByPlaceholderText(/Buscar/i);

    await user.type(busca, "Foro");
    expect(screen.queryByText(/selecionada\(s\)/)).toBeNull();

    await user.clear(busca);
    expect(screen.getByText(/1 selecionada\(s\)/)).toBeTruthy();
  });

  it("o checkbox escondido não fica marcado ao reaparecer por engano", async () => {
    const user = userEvent.setup();
    render(<ClausesPageClient clauses={CLAUSULAS} locacaoEnabled />);

    await user.click(screen.getByLabelText("Selecionar Sinal e arras"));
    const busca = screen.getByPlaceholderText(/Buscar/i);
    await user.type(busca, "Foro");
    await user.clear(busca);

    const row = screen.getByLabelText("Selecionar Sinal e arras");
    expect(row).toBeChecked();
    expect(screen.getByText(/1 selecionada\(s\)/)).toBeTruthy();
  });
});

describe("`ignored` deixa de ser silencioso (#484)", () => {
  it("avisa quando a rota descarta cláusulas de outra esteira", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        proposals: [],
        unchanged: [],
        undecided: [],
        failures: [],
        ignored: ["x1", "x2"],
      }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<ClausesPageClient clauses={CLAUSULAS} locacaoEnabled />);
    await user.click(screen.getByLabelText("Selecionar Sinal e arras"));
    await user.click(analisarDaBarra());

    expect(vi.mocked(toast.warning)).toHaveBeenCalledWith(
      expect.stringContaining("2 cláusula(s) ficaram de fora")
    );
  });

  // CONTROLE: sem ele, um `toast.warning` incondicional passaria no teste acima.
  it("não avisa quando `ignored` vem vazio", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        proposals: [],
        unchanged: ["v1"],
        undecided: [],
        failures: [],
        ignored: [],
      }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<ClausesPageClient clauses={CLAUSULAS} locacaoEnabled />);
    await user.click(screen.getByLabelText("Selecionar Sinal e arras"));
    await user.click(analisarDaBarra());

    expect(vi.mocked(toast.warning)).not.toHaveBeenCalled();
  });
});

describe("triagem: o modelo abster-se não é 'já classificada' (#480)", () => {
  it("mostra o caminho manual em vez de dizer que já está classificada", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        proposals: [],
        unchanged: [],
        undecided: ["n1"],
        failures: [],
        ignored: [],
      }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<ClausesPageClient clauses={CLAUSULAS} locacaoEnabled />);
    await user.click(screen.getByLabelText("Selecionar Cláusula sem triagem"));
    await user.click(analisarDaBarra());

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/não conseguiu decidir a esteira/i)
    ).toBeTruthy();
    expect(
      within(dialog).queryByText(/já estão classificadas/i)
    ).toBeNull();
  });
});

describe("o filtro de GRUPO preserva a seleção (contrato da #484)", () => {
  /**
   * A interseção é com `visiveis`, NÃO com `orderedSections` — este último já
   * filtra por `groupFilter` de propósito. Sem este teste, trocar a fonte da
   * interseção para `orderedSections` passaria em tudo e quebraria em silêncio
   * o contrato que o código documenta.
   */
  it("mudar o grupo não muda a contagem de selecionadas", async () => {
    const user = userEvent.setup();
    render(<ClausesPageClient clauses={CLAUSULAS} locacaoEnabled />);

    await user.click(screen.getByLabelText("Selecionar Sinal e arras"));
    expect(screen.getByText(/1 selecionada\(s\)/)).toBeTruthy();

    // Filtra por um grupo que NAO contem a clausula marcada (ela e G1).
    await user.click(screen.getByRole("combobox", { name: /grupo/i }));
    const opcoes = await screen.findAllByRole("option");
    const outro = opcoes.find(
      (o) => !/Todos os grupos|Sinal/i.test(o.textContent ?? "")
    );
    if (!outro) throw new Error("nenhum grupo alternativo disponivel");
    await user.click(outro);

    // A linha sumiu da lista, mas o item segue na mesma esteira e nos
    // `visiveis` — a contagem NAO pode mudar.
    expect(screen.getByText(/1 selecionada\(s\)/)).toBeTruthy();
  });
});

describe("lote misto: propostas + abstenção (#480)", () => {
  /**
   * O parágrafo secundário só aparece quando HÁ proposta e HÁ abstenção. O
   * outro teste de `undecided` usa `proposals: []` e passa pelo bloco vazio,
   * nunca por este — sem esta cobertura, inverter a condição não seria notado.
   */
  it("avisa que N continuam sem esteira mesmo quando houve proposta", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        proposals: [
          {
            clauseId: "v1",
            version: 1,
            title: "Sinal e arras",
            fields: { subcategory: { current: null, proposed: "sinal" } },
            warnings: [],
            reason: "texto fala em sinal",
          },
        ],
        unchanged: [],
        undecided: ["n1"],
        failures: [],
        ignored: [],
      }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<ClausesPageClient clauses={CLAUSULAS} locacaoEnabled />);
    await user.click(screen.getByLabelText("Selecionar Sinal e arras"));
    await user.click(analisarDaBarra());

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/continuam sem esteira/i)).toBeTruthy();
  });
});

describe("falha e abstenção coexistindo (#480)", () => {
  /**
   * Em cascata, a falha ganhava e a abstenção sumia — perda silenciosa. As duas
   * frases têm de aparecer: são fatos independentes sobre o mesmo lote.
   */
  it("mostra a falha E a abstenção, não só a falha", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        proposals: [],
        unchanged: [],
        undecided: ["n1"],
        failures: [{ clauseId: "v1", error: "timeout" }],
        ignored: [],
      }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<ClausesPageClient clauses={CLAUSULAS} locacaoEnabled />);
    await user.click(screen.getByLabelText("Selecionar Sinal e arras"));
    await user.click(analisarDaBarra());

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Não foi possível analisar/i)).toBeTruthy();
    expect(within(dialog).getByText(/não conseguiu decidir a esteira/i)).toBeTruthy();
  });
});
