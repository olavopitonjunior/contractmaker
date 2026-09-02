/**
 * `/settings/membros` — papel customizado não pode cair no select (issue #473).
 *
 * O select lista só os cinco presets. Um membro `role: "custom"` fazia
 * `value="custom"` não casar com item nenhum: o campo renderizava VAZIO, e o
 * primeiro clique — o gesto natural de quem acha o componente quebrado —
 * disparava `handleChangeRole` e DEGRADAVA o membro para um preset, sem aviso
 * e sem desfazer pela tela.
 *
 * Não é hipótese: em produção os quatro membros `custom` são as contas do
 * agente Max, uma por org. Um clique acidental muda o que o Max pode fazer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MembersPageClient } from "../MembersPageClient";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/hooks/useElevation", () => ({
  useElevation: () => ({
    hasScope: () => true,
    loading: false,
    scopes: [],
    refresh: vi.fn(),
  }),
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    can: () => true,
    loading: false,
    permissions: {},
    role: "owner",
  }),
}));
// A aba de convites busca sozinha; fora do escopo deste teste.
vi.mock("../InvitationsTab", () => ({
  InvitationsTab: () => <div data-testid="invitations-tab" />,
}));
vi.mock("../ElevationDialog", () => ({
  ElevationDialog: () => null,
}));

function membro(over: Record<string, unknown> = {}) {
  return {
    id: "m-1",
    userId: "u-1",
    role: "custom",
    customRoleId: "cr-1",
    customRoleName: "Max (agente)",
    invitedAt: "2026-05-01T08:00:00.000Z",
    lastActiveAt: null,
    user: {
      id: "u-1",
      name: "Max",
      email: "max+abc@agents.imobpro.local",
      image: null,
    },
    ...over,
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ members: [membro()] }),
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => vi.clearAllMocks());

/** A linha do membro, isolada pelo e-mail que só ela contém. */
async function linhaDoMembro(email: string) {
  const celula = await screen.findByText(email);
  const row = celula.closest("tr");
  if (!row) throw new Error("linha não encontrada");
  return row;
}

describe("MembersPageClient — papel customizado (#473)", () => {
  it("mostra o NOME do papel customizado, não um campo vazio", async () => {
    render(<MembersPageClient />);
    const row = await linhaDoMembro("max+abc@agents.imobpro.local");

    expect(within(row).getByText("Max (agente)")).toBeInTheDocument();
  });

  it("não renderiza combobox de função na linha do papel customizado", async () => {
    render(<MembersPageClient />);
    const row = await linhaDoMembro("max+abc@agents.imobpro.local");

    expect(within(row).queryByRole("combobox")).toBeNull();
  });

  /**
   * O coração da issue: o dano não era o campo feio, era o PATCH que o clique
   * disparava. Clicar no papel não pode chamar `/api/org/members/:id`.
   */
  it("clicar no papel não dispara troca de função", async () => {
    const user = userEvent.setup();
    render(<MembersPageClient />);
    const row = await linhaDoMembro("max+abc@agents.imobpro.local");

    await user.click(within(row).getByText("Max (agente)"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const patches = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === "PATCH"
    );
    expect(patches).toHaveLength(0);
  });

  /**
   * CONTROLE. Sem ele, "esconder o select de todo mundo" passaria nos três
   * testes acima e quebraria a tela inteira em silêncio: membro com papel
   * embutido CONTINUA editável.
   */
  it("membro com papel embutido continua com o select editável", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        members: [
          membro({
            id: "m-2",
            userId: "u-2",
            role: "gerente",
            customRoleId: null,
            customRoleName: null,
            user: {
              id: "u-2",
              name: "Ana",
              email: "ana@imobiliaria.com",
              image: null,
            },
          }),
        ],
      }),
    });

    render(<MembersPageClient />);
    const row = await linhaDoMembro("ana@imobiliaria.com");

    expect(within(row).getByRole("combobox")).toBeInTheDocument();
  });
});
