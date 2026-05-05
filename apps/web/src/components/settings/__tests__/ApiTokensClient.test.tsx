import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiTokensClient } from "../ApiTokensClient";

// Mock sonner — só silencia, nada visual.
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const initialTokens = [
  {
    id: "tk-1",
    name: "Newton (VPS)",
    scopes: ["deals:rw", "metrics:r"],
    lastUsedAt: "2026-05-04T10:00:00.000Z",
    expiresAt: null,
    revokedAt: null,
    createdAt: "2026-05-01T08:00:00.000Z",
  },
];

describe("ApiTokensClient", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renderiza tokens iniciais", () => {
    render(<ApiTokensClient initialTokens={initialTokens} />);
    expect(screen.getByText("Newton (VPS)")).toBeInTheDocument();
    expect(screen.getByText("deals:rw")).toBeInTheDocument();
    expect(screen.getByText("metrics:r")).toBeInTheDocument();
    expect(screen.getByText("Ativo")).toBeInTheDocument();
  });

  it("estado vazio quando sem tokens", () => {
    render(<ApiTokensClient initialTokens={[]} />);
    expect(screen.getByText(/Nenhum token criado/)).toBeInTheDocument();
  });

  it("cria token e exibe rawToken UMA VEZ", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        rawToken: "cmt_secret_xyz",
        token: {
          id: "tk-2",
          name: "MCP Local",
          scopes: ["contracts:rw"],
          expiresAt: null,
          createdAt: "2026-05-05T00:00:00.000Z",
        },
        warning: "Salve agora",
      }),
    });

    const user = userEvent.setup();
    render(<ApiTokensClient initialTokens={[]} />);
    await user.click(screen.getByRole("button", { name: /Novo token/i }));

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Nome/), "MCP Local");
    await user.click(within(dialog).getByLabelText(/Contratos \(read\/write\)/));
    await user.click(within(dialog).getByRole("button", { name: /^Criar token$/ }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/me/api-tokens",
      expect.objectContaining({
        method: "POST",
      })
    );
    const callBody = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(callBody).toMatchObject({
      name: "MCP Local",
      scopes: ["contracts:rw"],
      expiresInDays: 365,
    });

    // Raw token visível
    await waitFor(() => {
      expect(screen.getByText("cmt_secret_xyz")).toBeInTheDocument();
    });
    expect(screen.getByText(/Salve este token agora/)).toBeInTheDocument();

    // Token novo aparece na lista
    expect(screen.getByText("MCP Local")).toBeInTheDocument();
  });

  it("revoga token chama DELETE e marca como Revogado", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ revoked: true }),
    });

    const user = userEvent.setup();
    render(<ApiTokensClient initialTokens={initialTokens} />);

    // Botão lixeira (sem nome acessível — usa role)
    const trashButtons = screen.getAllByRole("button");
    const trashBtn = trashButtons.find((b) =>
      b.querySelector("svg.lucide-trash2")
    );
    expect(trashBtn).toBeDefined();
    await user.click(trashBtn!);

    const confirmDialog = await screen.findByRole("alertdialog");
    await user.click(within(confirmDialog).getByRole("button", { name: /^Revogar$/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/me/api-tokens/tk-1", {
        method: "DELETE",
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Revogado")).toBeInTheDocument();
    });
  });
});
