import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { resolveNotificationUsers } from "../user-recipients";

const membershipMany = prisma.orgMembership.findMany as unknown as ReturnType<typeof vi.fn>;
const dealFind = prisma.deal.findUnique as unknown as ReturnType<typeof vi.fn>;

function member(userId: string, over: Record<string, unknown> = {}) {
  return {
    userId,
    user: {
      name: `Nome ${userId}`,
      phone: "+5511987654321",
      email: `${userId}@x.com`,
      deletedAt: null,
    },
    ...over,
  };
}

function notif(over: Record<string, unknown> = {}) {
  return {
    id: "n1",
    orgId: "org1",
    userId: null,
    type: "form_completed",
    linkUrl: null,
    metadata: null,
    ...over,
  };
}

describe("resolveNotificationUsers — cascata de destinatários", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    membershipMany.mockResolvedValue([]);
    dealFind.mockResolvedValue(null);
  });

  it("notificação direcionada resolve só o alvo, mesmo havendo deal", async () => {
    membershipMany.mockResolvedValue([member("alvo")]);

    const r = await resolveNotificationUsers(
      notif({ userId: "alvo", metadata: { dealId: "deal1" } })
    );

    expect(r.rule).toBe("direct");
    expect(r.users.map((u) => u.userId)).toEqual(["alvo"]);
    // Não foi atrás do deal: o alvo já estava declarado.
    expect(dealFind).not.toHaveBeenCalled();
  });

  it("sem userId, usa o dono do deal do metadata", async () => {
    dealFind.mockResolvedValue({ userId: "dono", pipeline: { orgId: "org1" } });
    membershipMany.mockResolvedValue([member("dono")]);

    const r = await resolveNotificationUsers(notif({ metadata: { dealId: "deal1" } }));

    expect(r.rule).toBe("deal_owner");
    expect(r.users.map((u) => u.userId)).toEqual(["dono"]);
  });

  it("cai pro linkUrl quando o metadata não traz dealId (certidao_problem)", async () => {
    dealFind.mockResolvedValue({ userId: "dono", pipeline: { orgId: "org1" } });
    membershipMany.mockResolvedValue([member("dono")]);

    const r = await resolveNotificationUsers(
      notif({ type: "certidao_problem", linkUrl: "/deals/clx1234567890abcdefgh" })
    );

    expect(r.rule).toBe("deal_owner");
    expect(dealFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "clx1234567890abcdefgh" } })
    );
  });

  it("reconhece link de locação", async () => {
    dealFind.mockResolvedValue({ userId: "dono", pipeline: { orgId: "org1" } });
    membershipMany.mockResolvedValue([member("dono")]);

    await resolveNotificationUsers(
      notif({ linkUrl: "/locacao/deals/clx1234567890abcdefgh" })
    );

    expect(dealFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "clx1234567890abcdefgh" } })
    );
  });

  it("deal de OUTRA org não vaza o dono — cai pro fallback de admins", async () => {
    dealFind.mockResolvedValue({ userId: "dono", pipeline: { orgId: "org-outra" } });
    membershipMany.mockResolvedValue([member("admin1")]);

    const r = await resolveNotificationUsers(notif({ metadata: { dealId: "deal1" } }));

    expect(r.rule).toBe("org_admins");
    expect(r.users.map((u) => u.userId)).toEqual(["admin1"]);
  });

  it("org-wide sem deal vai pros owners/admins, limitado a 5", async () => {
    const admins = Array.from({ length: 9 }, (_, i) => ({ userId: `a${i}` }));
    membershipMany
      .mockResolvedValueOnce(admins.slice(0, 5)) // take: 5 na query de admins
      .mockResolvedValueOnce(admins.slice(0, 5).map((a) => member(a.userId)));

    const r = await resolveNotificationUsers(notif({ type: "ai_budget_threshold" }));

    expect(r.rule).toBe("org_admins");
    expect(r.users).toHaveLength(5);
    expect(membershipMany.mock.calls[0][0]).toMatchObject({
      where: { orgId: "org1", role: { in: ["owner", "admin"] } },
      take: 5,
    });
  });

  /**
   * INVERTIDO em 2026-07-30: o gerente saiu desta cascata. Os avisos externos
   * dele (e-mail/WhatsApp dos marcos) passaram a sair pelo motor
   * lib/notifications/deal-events.ts, no público `manager`, com config própria
   * por evento×canal e log no DealNotificationLog. Mantê-lo aqui entregaria a
   * MESMA notificação duas vezes, por dois trilhos cujos dedupes não se
   * enxergam. O sino dele continua vindo do fan-out `:mgr` de emitNotification.
   */
  it("gerente do deal NÃO entra na cascata — quem resolve é o motor deal-events", async () => {
    dealFind.mockResolvedValue({
      userId: "dono",
      managerUserId: "gerente",
      pipeline: { orgId: "org1" },
    });
    membershipMany.mockResolvedValue([member("dono")]);

    const r = await resolveNotificationUsers(notif({ metadata: { dealId: "deal1" } }));

    expect(r.rule).toBe("deal_owner");
    expect(r.users.map((u) => u.userId)).toEqual(["dono"]);
    // O gerente nem chega a ser consultado na elegibilidade.
    expect(membershipMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: { in: ["dono"] } }),
      })
    );
  });

  it("gerente que também é o dono continua recebendo — pelo trilho de dono", async () => {
    dealFind.mockResolvedValue({
      userId: "gerente",
      managerUserId: "gerente",
      pipeline: { orgId: "org1" },
    });
    membershipMany.mockResolvedValue([member("gerente")]);

    const r = await resolveNotificationUsers(notif({ metadata: { dealId: "deal1" } }));

    expect(r.rule).toBe("deal_owner");
    expect(r.users.map((u) => u.userId)).toEqual(["gerente"]);
  });

  it("ex-membro não recebe: sem OrgMembership, some da lista", async () => {
    membershipMany.mockResolvedValue([]); // saiu da org

    const r = await resolveNotificationUsers(notif({ userId: "ex-membro" }));

    expect(r.users).toEqual([]);
  });

  it("conta com soft-delete (LGPD) é excluída", async () => {
    membershipMany.mockResolvedValue([
      member("morto", {
        user: { name: "X", phone: "+5511987654321", deletedAt: new Date() },
      }),
    ]);

    const r = await resolveNotificationUsers(notif({ userId: "morto" }));

    expect(r.users).toEqual([]);
  });

  it("erro de DB não propaga", async () => {
    membershipMany.mockRejectedValue(new Error("db caiu"));

    await expect(
      resolveNotificationUsers(notif({ userId: "x" }))
    ).resolves.toEqual({ users: [], rule: "none" });
  });
});

// ── Lista escolhida pelo admin (settingsJson.userRecipients) ────────────────
//
// O que estes testes protegem: a cascata resolve no DONO do negócio, e quem
// acompanha o processo inteiro sem ser dono de nada (a negociadora) nunca era
// alcançado. A lista soma — mas não pode somar em notificação direcionada, que
// é privada no sino, nem furar o teto em silêncio.

const orgSettingsFind = prisma.orgNotificationSettings
  .findUnique as unknown as ReturnType<typeof vi.fn>;

function comLista(events: Record<string, string[]>) {
  orgSettingsFind.mockResolvedValue({ settingsJson: { userRecipients: { events } } });
}

/**
 * Mock de orgMembership.findMany que RESPEITA o `where`. `loadEligible` confia
 * no filtro da query (não filtra em memória), então um mock que devolve todo
 * mundo esconderia exatamente o bug de vazar destinatário — foi o que quase
 * passou aqui. Trata as duas formas usadas: filtro por `userId.in` (elegíveis)
 * e por `role.in` (busca de admins).
 */
function comMembros(...ms: ReturnType<typeof member>[]) {
  membershipMany.mockImplementation((args?: { where?: Record<string, unknown>; take?: number }) => {
    const where = args?.where ?? {};
    const ids = (where.userId as { in?: string[] } | undefined)?.in;
    let out = ms;
    if (ids) out = ms.filter((m) => ids.includes(m.userId));
    else if (where.role) out = ms.filter((m) => (m as { role?: string }).role !== undefined);
    return Promise.resolve(args?.take ? out.slice(0, args.take) : out);
  });
}

describe("resolveNotificationUsers — destinatários escolhidos pelo admin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    comMembros();
    dealFind.mockResolvedValue(null);
    orgSettingsFind.mockResolvedValue(null);
  });

  it("a lista deixou de ser por categoria — vale para qualquer aviso", async () => {
    comLista({ deal_updates: ["marcia"] });
    dealFind.mockResolvedValue({ userId: "dono", pipeline: { orgId: "org1" } });
    comMembros(member("dono"), member("marcia"));

    // Sem canal explícito, o default é whatsapp (compatível com o chamador antigo).
    const r = await resolveNotificationUsers(notif({ metadata: { dealId: "deal1" } }));

    expect(r.rule).toBe("org_selected");
    expect(r.users.map((u) => u.userId).sort()).toEqual(["dono", "marcia"]);
  });

  it("forma legada (events.<categoria>) continua valendo — sem backfill", async () => {
    // É exatamente o que está gravado em produção desde o #194.
    comLista({ deal_updates: ["marcia"] });
    dealFind.mockResolvedValue({ userId: "olavo", pipeline: { orgId: "org1" } });
    comMembros(member("olavo"), member("marcia"));

    const r = await resolveNotificationUsers(
      notif({ metadata: { dealId: "deal1" } }),
      "whatsapp"
    );

    expect(r.users.map((u) => u.userId)).toContain("marcia");
  });

  it("quem não tem telefone ainda recebe por E-MAIL", async () => {
    // O contato exigido é o do canal. Filtrar e-mail por telefone faria sumir
    // justamente quem só usa e-mail.
    comLista({ deal_updates: ["semfone"] });
    dealFind.mockResolvedValue({ userId: "dono", pipeline: { orgId: "org1" } });
    comMembros(
      member("dono"),
      member("semfone", {
        user: { name: "Sem Fone", phone: null, email: "s@x.com", deletedAt: null },
      })
    );

    const wa = await resolveNotificationUsers(
      notif({ metadata: { dealId: "deal1" } }),
      "whatsapp"
    );
    expect(wa.users.map((u) => u.userId)).not.toContain("semfone");

    const email = await resolveNotificationUsers(
      notif({ metadata: { dealId: "deal1" } }),
      "email"
    );
    expect(email.users.map((u) => u.userId)).toContain("semfone");
  });

  it("soma o escolhido ao dono do negócio", async () => {
    comLista({ deal_updates: ["marcia"] });
    dealFind.mockResolvedValue({ userId: "dono", pipeline: { orgId: "org1" } });
    comMembros(member("dono"), member("marcia"));

    const r = await resolveNotificationUsers(
      notif({ metadata: { dealId: "deal1" } }),
      "whatsapp"
    );

    expect(r.rule).toBe("org_selected");
    expect(r.users.map((u) => u.userId).sort()).toEqual(["dono", "marcia"]);
  });

  it("alcança o escolhido em negócio de OUTRO dono — o caso que motivou", async () => {
    comLista({ deal_updates: ["marcia"] });
    dealFind.mockResolvedValue({ userId: "olavo", pipeline: { orgId: "org1" } });
    comMembros(member("olavo"), member("marcia"));

    const r = await resolveNotificationUsers(
      notif({ metadata: { dealId: "deal-do-olavo" } }),
      "whatsapp"
    );

    expect(r.users.map((u) => u.userId)).toContain("marcia");
  });

  it("dono que também está na lista aparece uma vez só", async () => {
    comLista({ deal_updates: ["marcia"] });
    dealFind.mockResolvedValue({ userId: "marcia", pipeline: { orgId: "org1" } });
    comMembros(member("marcia"));

    const r = await resolveNotificationUsers(
      notif({ metadata: { dealId: "deal1" } }),
      "whatsapp"
    );

    expect(r.users.map((u) => u.userId)).toEqual(["marcia"]);
  });

  it("NÃO soma em notificação direcionada — ela é privada no sino", async () => {
    comLista({ deal_updates: ["marcia"] });
    comMembros(member("alvo"), member("marcia"));

    const r = await resolveNotificationUsers(
      notif({ userId: "alvo", metadata: { dealId: "deal1" } }),
      "whatsapp"
    );

    expect(r.rule).toBe("direct");
    expect(r.users.map((u) => u.userId)).toEqual(["alvo"]);
  });

  it("lista de outra categoria não vaza pra esta", async () => {
    comLista({ financeiro: ["tesoureiro"] });
    dealFind.mockResolvedValue({ userId: "dono", pipeline: { orgId: "org1" } });
    comMembros(member("dono"));

    const r = await resolveNotificationUsers(
      notif({ metadata: { dealId: "deal1" } }),
      "whatsapp"
    );

    expect(r.users.map((u) => u.userId)).toEqual(["dono"]);
  });

  it("quem não é membro da org é descartado pela elegibilidade", async () => {
    comLista({ deal_updates: ["estranho"] });
    dealFind.mockResolvedValue({ userId: "dono", pipeline: { orgId: "org1" } });
    comMembros(member("dono")); // 'estranho' não volta

    const r = await resolveNotificationUsers(
      notif({ metadata: { dealId: "deal1" } }),
      "whatsapp"
    );

    expect(r.users.map((u) => u.userId)).toEqual(["dono"]);
  });

  it("quem não tem telefone é descartado", async () => {
    comLista({ deal_updates: ["semfone"] });
    dealFind.mockResolvedValue({ userId: "dono", pipeline: { orgId: "org1" } });
    comMembros(member("dono"),
      member("semfone", { user: { name: "Sem Fone", phone: null, deletedAt: null } }),);

    const r = await resolveNotificationUsers(
      notif({ metadata: { dealId: "deal1" } }),
      "whatsapp"
    );

    expect(r.users.map((u) => u.userId)).toEqual(["dono"]);
  });

  it("respeita o teto de 5 e AVISA quem ficou fora", async () => {
    const escolhidos = ["u1", "u2", "u3", "u4", "u5", "u6"];
    comLista({ deal_updates: escolhidos });
    dealFind.mockResolvedValue({ userId: "dono", pipeline: { orgId: "org1" } });
    comMembros(member("dono"), ...escolhidos.map((u) => member(u)));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const r = await resolveNotificationUsers(
      notif({ metadata: { dealId: "deal1" } }),
      "whatsapp"
    );

    expect(r.users).toHaveLength(5);
    expect(warn).toHaveBeenCalled();
    // O aviso nomeia quem sobrou — corte silencioso lê como "avisei todos".
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/fora:/);
    warn.mockRestore();
  });

  it("o dono sobrevive ao teto — o corte só derruba escolhidos", async () => {
    // A ordem do input é [dono, ...escolhidos] e loadEligible a preserva; com
    // 6 candidatos e teto 5, quem cai é o último escolhido.
    const escolhidos = ["u1", "u2", "u3", "u4", "u5"];
    comLista({ deal_updates: escolhidos });
    dealFind.mockResolvedValue({
      userId: "dono",
      // Mesmo com gerente atribuído: ele não entra por aqui (recebe pelo motor
      // deal-events), então não ocupa vaga no teto.
      managerUserId: "gerente",
      pipeline: { orgId: "org1" },
    });
    comMembros(member("dono"), member("gerente"), ...escolhidos.map((u) => member(u)));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const r = await resolveNotificationUsers(
      notif({ metadata: { dealId: "deal1" } }),
      "whatsapp"
    );

    expect(r.users).toHaveLength(5);
    const ids = r.users.map((u) => u.userId);
    expect(ids).toContain("dono");
    expect(ids).not.toContain("gerente");
    expect(ids).not.toContain("u5");
    warn.mockRestore();
  });

  it("erro lendo a lista não derruba a cascata", async () => {
    orgSettingsFind.mockRejectedValue(new Error("db fora"));
    dealFind.mockResolvedValue({ userId: "dono", pipeline: { orgId: "org1" } });
    comMembros(member("dono"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await resolveNotificationUsers(
      notif({ metadata: { dealId: "deal1" } }),
      "whatsapp"
    );

    expect(r.users.map((u) => u.userId)).toEqual(["dono"]);
    err.mockRestore();
  });

  it("sem deal e sem admin, a lista sozinha ainda entrega", async () => {
    comLista({ deal_updates: ["marcia"] });
    membershipMany
      .mockResolvedValueOnce([])                 // busca de admins: nenhum
      .mockResolvedValue([member("marcia")]);    // loadEligible

    const r = await resolveNotificationUsers(notif(), "whatsapp");

    expect(r.rule).toBe("org_selected");
    expect(r.users.map((u) => u.userId)).toEqual(["marcia"]);
  });
});
