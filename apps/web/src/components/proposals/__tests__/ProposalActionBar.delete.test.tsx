/**
 * Espelho do ProposalRowActions.delete.test.tsx para o SEGUNDO consumidor do
 * predicado. A fiação (sentAt chegando na prop, guard aplicado, diálogo
 * fechando no erro) é duplicada entre os dois componentes — o predicado
 * compartilhado não protege a fiação, e foi na fiação que o bug do smoke
 * morava. Sem este arquivo, reverter o guard SÓ no ActionBar passava na suíte.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: (...a: unknown[]) => toastError(...a),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import { ProposalActionBar } from "../ProposalActionBar";
import type { ProposalPermissions } from "../ProposalRowActions";

const ALL: ProposalPermissions = {
  send: true, write: true, create: true, convert: true, cancel: true,
  delete: true, resend: true, assign: true,
};

function proposal(over: Partial<React.ComponentProps<typeof ProposalActionBar>["proposal"]> = {}) {
  return {
    id: "p1", status: "falha_envio", kind: "venda",
    instrument: "envelope", convertedDealId: null, sentAt: null, ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

describe("ActionBar: Excluir espelha o guard do servidor", () => {
  it("falha_envio que nunca saiu → Excluir aparece", () => {
    render(<ProposalActionBar proposal={proposal()} permissions={ALL} />);
    expect(screen.queryByRole("button", { name: /Excluir/ })).not.toBeNull();
  });

  it("falha_envio que já saiu → Excluir some", () => {
    render(
      <ProposalActionBar
        proposal={proposal({ sentAt: "2026-08-19T10:00:00.000Z" })}
        permissions={ALL}
      />
    );
    expect(screen.queryByRole("button", { name: /Excluir/ })).toBeNull();
  });
});

describe("ActionBar: diálogo fecha quando a ação falha", () => {
  it("DELETE recusado → toast de erro e diálogo fechado", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "Não pode." }),
    });
    render(<ProposalActionBar proposal={proposal()} permissions={ALL} />);
    await userEvent.click(screen.getByRole("button", { name: /Excluir/ }));
    // o botão de confirmação dentro do AlertDialog também se chama Excluir
    const confirm = await screen.findByText("Excluir proposta");
    expect(confirm).not.toBeNull();
    const buttons = screen.getAllByRole("button", { name: /^Excluir$/ });
    await userEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("Excluir proposta")).toBeNull());
  });
});
