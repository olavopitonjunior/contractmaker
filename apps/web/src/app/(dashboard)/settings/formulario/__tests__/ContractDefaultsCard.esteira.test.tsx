/**
 * Recorte: o que sobrevive à troca de esteira.
 *
 * Trocar Vendas↔Locação é render CONDICIONAL. Enquanto cada filho tinha o
 * próprio `useState(initial)` E o próprio `useSettingsAutoSave`, remontar
 * recomeçava os dois do zero, e isso quebrava de duas formas:
 *
 * 1. O estado ressemeava do snapshot que a RSC leu no carregamento da página:
 *    depois de um save bem-sucedido o campo voltava a mostrar o valor
 *    PRÉ-edição, com o servidor já correto.
 *
 * 2. Pior, e silencioso: se o flush do unmount FALHASSE, o hook novo semeava
 *    `baselineRef` a partir do estado já editado, `dirtyKeys` nascia vazio e a
 *    pill sumia — afirmando "sem pendências" enquanto o servidor seguia no
 *    valor velho. O `catch` do hook só publica erro `if (mountedRef.current)`,
 *    e no flush de unmount o componente já morreu: nem status, nem toast.
 *
 * Estado e hook vivem no pai, que NÃO desmonta na troca. O segundo teste é o
 * que trava o item 2 — ele usa o hook REAL, não um mock.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  DEFAULT_CONTRACT_SETTINGS,
  DEFAULT_LOCACAO_SETTINGS,
  DEFAULT_LOCACAO_COMISSAO,
  DEFAULT_LOCACAO_RECEBIMENTO,
} from "@/lib/contracts/default-config";

let esteira: "venda" | "locacao" = "venda";
vi.mock("../EsteiraTabs", () => ({
  useEsteira: () => esteira,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

import { ContractDefaultsCard } from "../ContractDefaultsCard";

const props = {
  initial: DEFAULT_CONTRACT_SETTINGS,
  initialLocacao: DEFAULT_LOCACAO_SETTINGS,
  initialComissaoLocacao: DEFAULT_LOCACAO_COMISSAO,
  initialRecebimentoLocacao: DEFAULT_LOCACAO_RECEBIMENTO,
  locacaoEnabled: true,
};

const checkbox = () =>
  screen.getByRole("checkbox", {
    name: /permitir por padrão/i,
  }) as HTMLInputElement;

beforeEach(() => {
  esteira = "venda";
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ContractDefaultsCard — troca de esteira", () => {
  it("a edição continua na tela depois de ir a Locação e voltar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    );
    const { rerender } = render(<ContractDefaultsCard {...props} />);

    const antes = checkbox().checked;
    fireEvent.click(checkbox());
    expect(checkbox().checked).toBe(!antes);

    // Deixa o debounce vencer DENTRO do teste: sem isto o timer sobrevive ao
    // `afterEach`, os timers voltam a ser reais e o PATCH escapa para a rede
    // de verdade (ECONNREFUSED no log de quem rodar a suíte).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });

    // Sai de Vendas: o formulário desmonta de verdade (render condicional).
    esteira = "locacao";
    rerender(<ContractDefaultsCard {...props} />);
    expect(
      screen.queryByRole("checkbox", { name: /permitir por padrão/i })
    ).toBeNull();

    // Volta: tem de estar o valor editado, não o `initial` da RSC.
    esteira = "venda";
    rerender(<ContractDefaultsCard {...props} />);
    expect(checkbox().checked).toBe(!antes);
  });

  // Hook REAL: é o ciclo baseline/flush que está sob teste, não o estado.
  it("save que FALHA continua sinalizado depois da troca de esteira — não vira 'limpo'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("rede caiu")));

    const { rerender } = render(<ContractDefaultsCard {...props} />);
    fireEvent.click(checkbox());

    // Deixa o debounce (800ms) vencer e o PATCH falhar.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(fetch).toHaveBeenCalled();

    esteira = "locacao";
    rerender(<ContractDefaultsCard {...props} />);
    esteira = "venda";
    rerender(<ContractDefaultsCard {...props} />);

    // A pill só some quando está `idle` E sem sujeira — exatamente o estado
    // que mentiria aqui. Ela tem de continuar dizendo alguma coisa.
    const pill =
      screen.queryByText(/não foi possível salvar/i) ??
      screen.queryByText(/alterações não salvas/i);
    expect(pill).not.toBeNull();
  });
});
