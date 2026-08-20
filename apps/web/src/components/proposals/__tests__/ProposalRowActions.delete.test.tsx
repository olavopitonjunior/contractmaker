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
