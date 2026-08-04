import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getOnboardingStatus } from "../status";

const orgFind = prisma.organization.findUnique as unknown as ReturnType<typeof vi.fn>;
const gAcc = prisma.orgGoogleAccount.findUnique as unknown as ReturnType<typeof vi.fn>;
const tmplCount = prisma.contractTemplate.count as unknown as ReturnType<typeof vi.fn>;
const formFind = prisma.orgFormSettings.findUnique as unknown as ReturnType<typeof vi.fn>;
const inviteCount = prisma.orgInvitation.count as unknown as ReturnType<typeof vi.fn>;
const memberCount = prisma.orgMembership.count as unknown as ReturnType<typeof vi.fn>;
const dealCount = prisma.deal.count as unknown as ReturnType<typeof vi.fn>;
const orgModuleFindMany = prisma.orgModule.findMany as unknown as ReturnType<typeof vi.fn>;

const T0 = new Date("2026-07-01T10:00:00Z");
const T1 = new Date("2026-07-01T10:05:00Z");

describe("getOnboardingStatus (6 passos)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgModuleFindMany.mockResolvedValue([]); // fail-open → módulos habilitados
    orgFind.mockResolvedValue({ creci: null, legalName: null, onboardingCompletedAt: null });
    gAcc.mockResolvedValue(null);
    tmplCount.mockResolvedValue(0);
    formFind.mockResolvedValue(null);
    inviteCount.mockResolvedValue(0);
    memberCount.mockResolvedValue(0);
    dealCount.mockResolvedValue(0);
  });

  it("org nova: 6 passos obrigatórios + clicksign opcional, nenhum feito, incompleto", async () => {
    const s = await getOnboardingStatus("org1");
    expect(s.steps.map((x) => x.key)).toEqual([
      "google",
      "profile",
      "templates",
      "clicksign",
      "form",
      "invite",
      "deal",
    ]);
    // clicksign é opcional → não conta pro total obrigatório.
    expect(s.requiredTotal).toBe(6);
    expect(s.requiredDone).toBe(0);
    expect(s.complete).toBe(false);
    expect(s.steps.find((x) => x.key === "clicksign")?.required).toBe(false);
    expect(
      s.steps.filter((x) => x.key !== "clicksign").every((x) => x.required)
    ).toBe(true);
  });

  it("tudo configurado → 6/6 e complete", async () => {
    orgFind.mockResolvedValue({
      creci: "12345-J",
      legalName: "Imobiliária X",
      onboardingCompletedAt: null,
    });
    gAcc.mockResolvedValue({ status: "connected" });
    tmplCount.mockResolvedValue(1);
    formFind.mockResolvedValue({ preset: "completo", customRequiredPaths: [], createdAt: T0, updatedAt: T1 });
    inviteCount.mockResolvedValue(1);
    dealCount.mockResolvedValue(1);
    const s = await getOnboardingStatus("org1");
    expect(s.requiredDone).toBe(6);
    expect(s.complete).toBe(true);
  });

  it("form completa com QUALQUER save real (updatedAt > createdAt), mesmo preset legado", async () => {
    formFind.mockResolvedValue({
      preset: "legado",
      customRequiredPaths: [],
      createdAt: T0,
      updatedAt: T1,
    });
    const s = await getOnboardingStatus("org1");
    expect(s.steps.find((x) => x.key === "form")?.done).toBe(true);
  });

  it("form NÃO completa quando só a row lazy existe (updatedAt == createdAt, legado)", async () => {
    formFind.mockResolvedValue({
      preset: "legado",
      customRequiredPaths: [],
      createdAt: T0,
      updatedAt: T0,
    });
    const s = await getOnboardingStatus("org1");
    expect(s.steps.find((x) => x.key === "form")?.done).toBe(false);
  });

  it("invite completa por convite OU por membro extra (fallback)", async () => {
    // sem convite, mas há um membro além do owner
    memberCount.mockResolvedValue(1);
    const s = await getOnboardingStatus("org1");
    expect(s.steps.find((x) => x.key === "invite")?.done).toBe(true);
    // deal ainda escopado por pipeline.orgId
    expect(dealCount).toHaveBeenCalledWith({ where: { pipeline: { orgId: "org1" } } });
  });

  it("profile: detail aponta o campo faltante", async () => {
    orgFind.mockResolvedValue({
      creci: null,
      legalName: "Imobiliária X",
      onboardingCompletedAt: null,
    });
    const s = await getOnboardingStatus("org1");
    const profile = s.steps.find((x) => x.key === "profile")!;
    expect(profile.done).toBe(false);
    expect(profile.detail).toContain("CRECI");
  });
});

/**
 * Etapa do Max.
 *
 * O motivo dela existir não é ligar uma chave — é medir o gargalo que deixou os
 * quatro primeiros tenants com a feature verde e o agente mudo: 1 de 13 pessoas
 * com telefone cadastrado. Por isso o passo só fecha quando ALGUÉM de fato pode
 * receber, e não quando o provisionamento terminou.
 */
describe("etapa max", () => {
  const provFind = prisma.agentProvisioning.findUnique as unknown as ReturnType<
    typeof vi.fn
  >;
  const prefCount = prisma.userNotificationPreference
    .count as unknown as ReturnType<typeof vi.fn>;

  /** Liga a feature do Max para a org. */
  function comCanal() {
    orgModuleFindMany.mockResolvedValue([
      { module: "vendas", enabled: true, featureFlags: { "vendas.max": true } },
    ]);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    orgFind.mockResolvedValue({
      creci: null,
      legalName: null,
      onboardingCompletedAt: null,
    });
    gAcc.mockResolvedValue(null);
    tmplCount.mockResolvedValue(0);
    formFind.mockResolvedValue(null);
    inviteCount.mockResolvedValue(0);
    memberCount.mockResolvedValue(0);
    dealCount.mockResolvedValue(0);
    provFind.mockResolvedValue(null);
    prefCount.mockResolvedValue(0);
  });

  it("org sem o canal disponível NÃO vê a etapa", async () => {
    orgModuleFindMany.mockResolvedValue([]); // sem featureFlags → max off

    const s = await getOnboardingStatus("org1");

    expect(s.steps.map((x) => x.key)).not.toContain("max");
  });

  it("org com o canal vê a etapa, e ela é OPCIONAL", async () => {
    comCanal();

    const s = await getOnboardingStatus("org1");

    const max = s.steps.find((x) => x.key === "max");
    expect(max).toBeDefined();
    // Metade do passo depende de opt-in PESSOAL de outra pessoa (LGPD). Passo
    // obrigatório que o dono não fecha sozinho é onboarding que nunca termina.
    expect(max?.required).toBe(false);
  });

  it("não provisionado → não feito, e o detalhe diz o que falta", async () => {
    comCanal();

    const s = await getOnboardingStatus("org1");

    const max = s.steps.find((x) => x.key === "max");
    expect(max?.done).toBe(false);
    expect(max?.detail).toBe("aguardando ativação");
  });

  /**
   * O caso central: provisionado E entregue, mas ninguém recebe. É o estado real
   * dos quatro tenants hoje, e mostrá-lo como concluído seria mentir.
   */
  it("provisionado mas sem ninguém recebendo → NÃO está feito", async () => {
    comCanal();
    provFind.mockResolvedValue({ status: "active", deliveredAt: new Date() });
    memberCount.mockResolvedValue(6); // 6 pessoas com telefone
    prefCount.mockResolvedValue(0); // nenhuma optou

    const s = await getOnboardingStatus("org1");

    const max = s.steps.find((x) => x.key === "max");
    expect(max?.done).toBe(false);
    expect(max?.detail).toContain("ninguém optou por receber");
  });

  it("ninguém com telefone tem detalhe próprio — é a causa raiz", async () => {
    comCanal();
    provFind.mockResolvedValue({ status: "active", deliveredAt: new Date() });
    memberCount.mockResolvedValue(0);
    prefCount.mockResolvedValue(0);

    const s = await getOnboardingStatus("org1");

    expect(s.steps.find((x) => x.key === "max")?.detail).toBe(
      "ninguém com telefone cadastrado ainda"
    );
  });

  /**
   * `deliveredAt` nulo com `status: "active"` é o estado das orgs provisionadas
   * por script. Afirmar entrega que ninguém observou é o erro que já custou um
   * hotfix — o passo não fecha nesse estado.
   */
  it("ativo SEM confirmação de entrega não conta como provisionado", async () => {
    comCanal();
    provFind.mockResolvedValue({ status: "active", deliveredAt: null });
    prefCount.mockResolvedValue(3);

    const s = await getOnboardingStatus("org1");

    const max = s.steps.find((x) => x.key === "max");
    expect(max?.done).toBe(false);
    expect(max?.detail).toBe("aguardando ativação");
  });

  it("entregue e com gente recebendo → feito, sem detalhe", async () => {
    comCanal();
    provFind.mockResolvedValue({ status: "active", deliveredAt: new Date() });
    memberCount.mockResolvedValue(6);
    prefCount.mockResolvedValue(2);

    const s = await getOnboardingStatus("org1");

    const max = s.steps.find((x) => x.key === "max");
    expect(max?.done).toBe(true);
    expect(max?.detail).toBeUndefined();
  });

  /**
   * Sendo opcional, ligar o canal não pode aumentar o total obrigatório — senão
   * toda org com Max regride de 100% para 6/7 sem ter feito nada errado.
   */
  it("a etapa não altera o total de passos obrigatórios", async () => {
    comCanal();

    const s = await getOnboardingStatus("org1");

    expect(s.requiredTotal).toBe(6);
  });
});
