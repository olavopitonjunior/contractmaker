/**
 * Gating do "Recriar proposta" no ActionBar — espelha o predicado do servidor
 * (RECREATABLE_STATUSES) e a fiação: exigir `cancel` só no caminho que passa
 * pelo POST /cancel, sumir depois de recriada (supersededById), e navegar
 * direto nos terminais (sem diálogo).
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: vi.fn(),
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

function proposal(
  over: Partial<React.ComponentProps<typeof ProposalActionBar>["proposal"]> = {}
) {
  return {
    id: "p1", status: "enviada", kind: "venda",
    instrument: "envelope", convertedDealId: null,
    sentAt: "2026-08-19T10:00:00.000Z", supersededById: null, ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

describe("ActionBar: gating do Recriar", () => {
  it("enviada com write+cancel → botão aparece", () => {
    render(<ProposalActionBar proposal={proposal()} permissions={ALL} />);
    expect(screen.queryByRole("button", { name: /Recriar proposta/ })).not.toBeNull();
  });

  it("rascunho → não aparece (basta editar)", () => {
    render(
      <ProposalActionBar proposal={proposal({ status: "rascunho", sentAt: null })} permissions={ALL} />
    );
    expect(screen.queryByRole("button", { name: /Recriar proposta/ })).toBeNull();
  });

  it("já recriada (supersededById) → some", () => {
    render(
      <ProposalActionBar proposal={proposal({ supersededById: "p2" })} permissions={ALL} />
    );
    expect(screen.queryByRole("button", { name: /Recriar proposta/ })).toBeNull();
  });

  it("SEND sem CREATE → some (a ação termina num POST de criação; write não basta)", () => {
    render(
      <ProposalActionBar
        proposal={proposal()}
        permissions={{ ...ALL, create: false }}
      />
    );
    expect(screen.queryByRole("button", { name: /Recriar proposta/ })).toBeNull();
  });

  it("status vivo sem permissão de cancelar → some (o cancel faz parte da ação)", () => {
    render(
      <ProposalActionBar proposal={proposal()} permissions={{ ...ALL, cancel: false }} />
    );
    expect(screen.queryByRole("button", { name: /Recriar proposta/ })).toBeNull();
  });

  it("terminal (expirada) sem cancel → aparece e navega direto, sem diálogo", async () => {
    render(
      <ProposalActionBar
        proposal={proposal({ status: "expirada" })}
        permissions={{ ...ALL, cancel: false }}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /Recriar proposta/ }));
    expect(push).toHaveBeenCalledWith("/pipeline/propostas/nova?fromId=p1");
    expect(screen.queryByText(/será\s+cancelada/)).toBeNull();
  });
});

describe("ActionBar: fluxo cancelar-e-recriar", () => {
  it("status vivo → diálogo com motivo; confirmar chama /cancel e navega pro fromId", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    render(<ProposalActionBar proposal={proposal()} permissions={ALL} />);
    await userEvent.click(screen.getByRole("button", { name: /Recriar proposta/ }));
    // Título do botão e do diálogo coincidem — ancora na descrição do diálogo.
    expect(await screen.findByText(/será/)).not.toBeNull();

    const confirm = screen.getByRole("button", { name: /Cancelar e recriar/ });
    // Motivo < 3 chars → confirmação travada.
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(
      screen.getByPlaceholderText(/Motivo/),
      "cliente não recebeu"
    );
    await userEvent.click(screen.getByRole("button", { name: /Cancelar e recriar/ }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/proposals/p1/cancel",
      expect.objectContaining({ method: "POST" })
    );
    expect(push).toHaveBeenCalledWith("/pipeline/propostas/nova?fromId=p1");
  });
});
