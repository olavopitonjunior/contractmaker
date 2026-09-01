/**
 * Recorte: a edição sobrevive à troca de esteira.
 *
 * Trocar Vendas↔Locação é render CONDICIONAL — o formulário da esteira que sai
 * desmonta. Enquanto cada filho tinha o próprio `useState(initial)`, remontar
 * ressemeava do snapshot que a RSC leu no carregamento da página: depois de um
 * save bem-sucedido, o campo voltava a mostrar o valor PRÉ-edição com o
 * servidor já correto. Para o usuário é a cara do bug de perda de edição que o
 * flush no unmount corrigiu — só que agora com a UI atrás do servidor.
 *
 * O estado passou a viver no pai, que NÃO desmonta na troca.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  DEFAULT_CONTRACT_SETTINGS,
  DEFAULT_LOCACAO_SETTINGS,
  DEFAULT_LOCACAO_COMISSAO,
} from "@/lib/contracts/default-config";

let esteira: "venda" | "locacao" = "venda";
vi.mock("../EsteiraTabs", () => ({
  useEsteira: () => esteira,
}));

// O auto-save real dispara fetch com debounce; aqui só o estado importa.
vi.mock("@/hooks/use-settings-auto-save", () => ({
  useSettingsAutoSave: () => ({
    status: "idle",
    error: null,
    isDirty: false,
    flush: vi.fn(),
  }),
}));

import { ContractDefaultsCard } from "../ContractDefaultsCard";

const props = {
  initial: DEFAULT_CONTRACT_SETTINGS,
  initialLocacao: DEFAULT_LOCACAO_SETTINGS,
  initialComissaoLocacao: DEFAULT_LOCACAO_COMISSAO,
  locacaoEnabled: true,
};

const checkbox = () =>
  screen.getByRole("checkbox", {
    name: /permitir por padrão/i,
  }) as HTMLInputElement;

beforeEach(() => {
  esteira = "venda";
});

describe("ContractDefaultsCard — estado sobrevive à troca de esteira", () => {
  it("edição em Vendas continua lá depois de ir a Locação e voltar", () => {
    const { rerender } = render(<ContractDefaultsCard {...props} />);

    const antes = checkbox().checked;
    fireEvent.click(checkbox());
    expect(checkbox().checked).toBe(!antes);

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
});
