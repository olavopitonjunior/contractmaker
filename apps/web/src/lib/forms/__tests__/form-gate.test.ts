import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isFormClosed,
  canAccessForm,
  formClosedResponse,
  viewerIsOrgMember,
} from "@/lib/forms/form-gate";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

const mockAuth = vi.mocked(auth);
const mockPrisma = vi.mocked(prisma);

/** Sessão de um usuário logado. */
function loggedIn(userId = "user1") {
  mockAuth.mockResolvedValue({ user: { id: userId } } as never);
}

function loggedOut() {
  mockAuth.mockResolvedValue(null as never);
}

/** `orgMembership.findFirst` devolve row só quando a org bate. */
function memberOf(...orgIds: string[]) {
  mockPrisma.orgMembership.findFirst.mockImplementation((async (args: {
    where: { orgId: string };
  }) => (orgIds.includes(args.where.orgId) ? { id: "m1" } : null)) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isFormClosed", () => {
  it("form em rascunho está aberto", () => {
    expect(isFormClosed({ orgId: "org1", completedAt: null })).toBe(false);
  });

  it("form enviado está fechado", () => {
    expect(isFormClosed({ orgId: "org1", completedAt: new Date() })).toBe(true);
  });

  it("form reaberto volta a ficar aberto sem perder completedAt", () => {
    // completedAt segue setado — é marco de SLA do funil, não estado de acesso.
    expect(
      isFormClosed({
        orgId: "org1",
        completedAt: new Date("2026-07-01"),
        reopenedAt: new Date("2026-07-10"),
      })
    ).toBe(false);
  });
});

describe("canAccessForm", () => {
  it("form aberto é público — não consulta sessão", async () => {
    loggedOut();
    await expect(
      canAccessForm({ orgId: "org1", completedAt: null })
    ).resolves.toBe(true);
    expect(mockAuth).not.toHaveBeenCalled();
  });

  it("form enviado nega anônimo", async () => {
    loggedOut();
    await expect(
      canAccessForm({ orgId: "org1", completedAt: new Date() })
    ).resolves.toBe(false);
  });

  it("form enviado libera membro da org dona", async () => {
    loggedIn();
    memberOf("org1");
    await expect(
      canAccessForm({ orgId: "org1", completedAt: new Date() })
    ).resolves.toBe(true);
  });

  it("form enviado NEGA usuário logado de outra org (IDOR cross-org)", async () => {
    // O teste que justifica o gate checar membership em vez de só "tem sessão":
    // com o link em mãos, um usuário de outro tenant leria o dossiê alheio.
    loggedIn("user-de-outro-tenant");
    memberOf("org-do-atacante");
    await expect(
      canAccessForm({ orgId: "org1", completedAt: new Date() })
    ).resolves.toBe(false);
  });

  it("form reaberto volta a ser público", async () => {
    loggedOut();
    await expect(
      canAccessForm({
        orgId: "org1",
        completedAt: new Date("2026-07-01"),
        reopenedAt: new Date("2026-07-10"),
      })
    ).resolves.toBe(true);
  });
});

describe("viewerIsOrgMember", () => {
  it("sessão sem user id não é membro", async () => {
    mockAuth.mockResolvedValue({ user: {} } as never);
    await expect(viewerIsOrgMember("org1")).resolves.toBe(false);
  });

  it("falha do auth() não vira acesso liberado", async () => {
    // Fail-closed: erro ao resolver sessão nega, não permite.
    mockAuth.mockRejectedValue(new Error("boom") as never);
    await expect(viewerIsOrgMember("org1")).resolves.toBe(false);
  });
});

describe("formClosedResponse", () => {
  it("devolve null quando pode acessar", async () => {
    loggedOut();
    await expect(
      formClosedResponse({ orgId: "org1", completedAt: null })
    ).resolves.toBeNull();
  });

  it("devolve 403 com reason form_closed pro client distinguir de travado", async () => {
    loggedOut();
    const res = await formClosedResponse({ orgId: "org1", completedAt: new Date() });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    await expect(res!.json()).resolves.toMatchObject({ reason: "form_closed" });
  });
});
