/**
 * Os dois bugs de UX que motivaram esta correção só existem no COMPONENTE —
 * testar o predicado puro não os pega. Se alguém reverter o
 * `!isFalhaEnvioAlreadyDelivered(...)` do `canDelete`, ou o `setDialog(null)`
 * do `catch`, o predicado continua "provado" e o usuário continua preso.
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
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a), info: vi.fn(), warning: vi.fn() },
}));

import { ProposalRowActions, type ProposalPermissions } from "../ProposalRowActions";

const ALL: ProposalPermissions = {
  send: true, write: true, convert: true, cancel: true,
  delete: true, resend: true, assign: true,
};

function row(over: Partial<React.ComponentProps<typeof ProposalRowActions>["proposal"]> = {}) {
  return {
    id: "p1", status: "falha_envio", kind: "venda", instrument: "envelope",
    convertedDealId: null, title: "Proposta", sentAt: null, ...over,
  };
}

async function openMenu() {
  await userEvent.click(screen.getByRole("button"));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

describe("botão Excluir espelha o guard do servidor", () => {
  it("falha_envio que NUNCA saiu → Excluir aparece", async () => {
    // Envio que não vingou e ninguém viu: apagar é o desfecho natural.
    render(<ProposalRowActions proposal={row({ sentAt: null })} permissions={ALL} members={[]} />);
    await openMenu();
    expect(screen.queryByText("Excluir")).not.toBeNull();
  });

  it("falha_envio que JÁ SAIU → Excluir some (a API responderia 409)", async () => {
    // O bug relatado no smoke: o botão reaparecia depois de cancelar o
    // envelope e toda confirmação morria em 409.
    render(
      <ProposalRowActions
        proposal={row({ sentAt: "2026-08-19T10:00:00.000Z" })}
        permissions={ALL}
        members={[]}
      />
    );
    await openMenu();
    expect(screen.queryByText("Excluir")).toBeNull();
  });
});

describe("diálogo de confirmação fecha quando a ação falha", () => {
  it("erro do servidor fecha o diálogo em vez de deixar o usuário preso", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "Esta proposta já foi enviada ao cliente." }),
    });

    // Cancelar (não excluir) para exercitar o caminho de erro com o botão
    // visível: `falha_envio` está em CANCELLABLE_STATUSES.
    render(<ProposalRowActions proposal={row()} permissions={ALL} members={[]} />);
    await openMenu();
    await userEvent.click(screen.getByText("Cancelar"));

    // O confirmar só habilita com motivo (>= 3 chars).
    await userEvent.type(await screen.findByPlaceholderText("Motivo do cancelamento"), "engano");
    await userEvent.click(screen.getByRole("button", { name: "Cancelar proposta" }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    // O diálogo NÃO pode continuar de pé por cima do toast de erro — era o
    // "usuário preso" relatado no smoke.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Cancelar proposta" })).toBeNull()
    );
  });
});
