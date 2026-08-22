/**
 * Quem pode LER CONVERSA no Mission Control do Max.
 *
 * A página é aberta a qualquer `PlatformRole` de propósito — `support` precisa
 * do painel de status para responder "o Max está no ar?". Mas conversa não é
 * status: é o que o corretor escreveu e o que o agente respondeu, de um tenant
 * do qual o staff de plataforma não é membro. O PRD decidiu que transcrição é
 * só de super-admin, e a página não implementava a decisão — bastava ter
 * qualquer role de plataforma.
 *
 * O que estes testes afirmam é a **ausência da chamada**, não a ausência do
 * texto na tela. É a diferença que importa: se o gate estivesse só no render, a
 * conversa já teria atravessado a rede e existido no processo. Um teste de
 * "não aparece" passaria igual e protegeria menos.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// `vi.hoisted` porque as fábricas de `vi.mock` sobem para o topo do arquivo:
// um `const` normal aqui não existiria ainda quando elas rodassem.
const { getPlatformRole, fetchMaxConversations, fetchMaxStatus, auth, redirect } =
  vi.hoisted(() => ({
    getPlatformRole: vi.fn(),
    fetchMaxConversations: vi.fn(),
    fetchMaxStatus: vi.fn(),
    auth: vi.fn(),
    redirect: vi.fn(() => {
      throw new Error("REDIRECT");
    }),
  }));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/auth", () => ({ auth }));
vi.mock("@/lib/security/rbac/platform", () => ({ getPlatformRole }));
vi.mock("@/lib/max/admin-client", () => ({
  fetchMaxStatus,
  fetchMaxConversations,
}));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    organization: { findMany: vi.fn().mockResolvedValue([{ id: "org-1", name: "RE/MAX Trio" }]) },
    agentProvisioning: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock("@/lib/modules/read", () => ({
  getOrgModules: vi.fn().mockResolvedValue({}),
  isFeatureEnabled: vi.fn().mockReturnValue(false),
}));

import MaxMissionControlPage from "../page";

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ user: { id: "u1" } });
  fetchMaxStatus.mockResolvedValue({ ok: false, reason: "not_configured" });
  fetchMaxConversations.mockResolvedValue({ ok: true, turns: [], nextCursor: null });
});

describe("/admin/max — quem lê conversa", () => {
  /**
   * O caso negado vem primeiro, como manda a regra de governança do PRD: uma
   * capacidade nasce desligada, e o teste que prova o "não" é o que precisa
   * existir antes do que prova o "sim".
   */
  it.each(["support", "billing"] as const)(
    "%s NÃO busca conversa, mesmo com orgId na query",
    async (role) => {
      getPlatformRole.mockResolvedValue({ role, scope: [] });

      await MaxMissionControlPage({ searchParams: { orgId: "org-1" } });

      expect(fetchMaxConversations).not.toHaveBeenCalled();
      // O painel de status continua sendo buscado: é o que estas roles vêm ver.
      expect(fetchMaxStatus).toHaveBeenCalled();
    }
  );

  it("super_admin busca a conversa do tenant escolhido", async () => {
    getPlatformRole.mockResolvedValue({ role: "super_admin", scope: [] });

    await MaxMissionControlPage({ searchParams: { orgId: "org-1" } });

    expect(fetchMaxConversations).toHaveBeenCalledWith({ orgId: "org-1", limit: 20 });
  });

  /**
   * Sem tenant escolhido a rota do serviço exigiria `scope=all`. A tela não
   * contorna isso — e nem super-admin dispara a busca por acidente de abrir a
   * página.
   */
  it("super_admin sem orgId não busca nada", async () => {
    getPlatformRole.mockResolvedValue({ role: "super_admin", scope: [] });

    await MaxMissionControlPage({ searchParams: {} });

    expect(fetchMaxConversations).not.toHaveBeenCalled();
  });

  it("sem PlatformRole nenhuma, a página redireciona antes de qualquer leitura", async () => {
    getPlatformRole.mockResolvedValue(null);

    await expect(
      MaxMissionControlPage({ searchParams: { orgId: "org-1" } })
    ).rejects.toThrow("REDIRECT");

    expect(fetchMaxConversations).not.toHaveBeenCalled();
    expect(fetchMaxStatus).not.toHaveBeenCalled();
  });
});
