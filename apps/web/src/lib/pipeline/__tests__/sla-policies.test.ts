import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { resolveSlaPolicies, recomputeSlaDeadlines } from "../sla-policies";
import { AGING_WARN_DAYS, AGING_DANGER_DAYS } from "../stage-config";

const pipelineFind = prisma.pipeline.findFirst as unknown as ReturnType<typeof vi.fn>;
const slaFindMany = prisma.slaPolicy.findMany as unknown as ReturnType<typeof vi.fn>;
const dealUpdateMany = prisma.deal.updateMany as unknown as ReturnType<typeof vi.fn>;
const histUpdateMany = prisma.dealStageHistory.updateMany as unknown as ReturnType<
  typeof vi.fn
>;
const executeRaw = prisma.$executeRaw as unknown as ReturnType<typeof vi.fn>;

const STAGES = [
  { id: "s0", name: "Formulário", position: 0 },
  { id: "s1", name: "Confecção de Contrato", position: 1 },
  { id: "s5", name: "Comissão paga", position: 5 },
  { id: "s6", name: "Negócio perdido", position: 6 },
];

beforeEach(() => {
  vi.clearAllMocks();
  pipelineFind.mockResolvedValue({ stages: STAGES });
  slaFindMany.mockResolvedValue([]);
  dealUpdateMany.mockResolvedValue({ count: 0 });
  histUpdateMany.mockResolvedValue({ count: 0 });
  executeRaw.mockResolvedValue(0);
});

describe("resolveSlaPolicies", () => {
  it("sem linha da org → defaults de código; terminais sempre sem SLA", async () => {
    const policies = await resolveSlaPolicies("org-1", "venda");
    expect(policies).toHaveLength(4);
    const form = policies.find((p) => p.stageId === "s0")!;
    expect(form).toMatchObject({
      warnDays: AGING_WARN_DAYS,
      dangerDays: AGING_DANGER_DAYS,
      enabled: true,
      terminal: false,
      source: "default",
    });
    const won = policies.find((p) => p.stageId === "s5")!;
    expect(won).toMatchObject({ terminal: true, warnDays: null, enabled: false });
    const lost = policies.find((p) => p.stageId === "s6")!;
    expect(lost.terminal).toBe(true);
  });

  // ANTES este caso afirmava o contrário ("desabilitada zera os dias"), e era
  // esse zeramento que destruía dado: a tela não recebia os prazos salvos,
  // preenchia 5/10 no lugar, e o Salvar seguinte regravava o default por cima.
  // Desligar e religar apagava a configuração sem ninguém pedir.
  it("linha da org sobrepõe o default; DESABILITADA preserva os dias salvos", async () => {
    slaFindMany.mockResolvedValue([
      { key: "s0", warnDays: 2, dangerDays: 4, enabled: true },
      { key: "s1", warnDays: 3, dangerDays: 6, enabled: false },
    ]);
    const policies = await resolveSlaPolicies("org-1", "venda");
    expect(policies.find((p) => p.stageId === "s0")).toMatchObject({
      warnDays: 2,
      dangerDays: 4,
      source: "custom",
    });
    expect(policies.find((p) => p.stageId === "s1")).toMatchObject({
      // Os 3/6 continuam vindo: quem quer saber se a etapa envelhece lê
      // `enabled`, não a ausência dos prazos.
      warnDays: 3,
      dangerDays: 6,
      enabled: false,
      source: "custom",
    });
  });

  // O `null` sobrevive onde ele significa de verdade "não existe SLA": stage
  // terminal não tem linha e nunca envelhece.
  it("stage TERMINAL continua sem prazos, mesmo com linha na tabela", async () => {
    slaFindMany.mockResolvedValue([
      { key: "s2", warnDays: 9, dangerDays: 9, enabled: true },
    ]);
    const policies = await resolveSlaPolicies("org-1", "venda");
    const terminal = policies.find((p) => p.terminal);
    expect(terminal).toBeDefined();
    expect(terminal).toMatchObject({
      warnDays: null,
      dangerDays: null,
      enabled: false,
    });
  });

  it("org sem pipeline do kind → lista vazia", async () => {
    pipelineFind.mockResolvedValue(null);
    expect(await resolveSlaPolicies("org-1", "locacao")).toEqual([]);
  });
});

describe("recomputeSlaDeadlines", () => {
  it("stage com SLA re-materializa via SQL; terminal/desabilitado zera via updateMany", async () => {
    slaFindMany.mockResolvedValue([
      { key: "s1", warnDays: 3, dangerDays: 6, enabled: false },
    ]);
    const r = await recomputeSlaDeadlines("org-1", "venda");
    expect(r.stages).toBe(4);

    // s0 (default habilitado) → UPDATE set-based com make_interval.
    expect(executeRaw).toHaveBeenCalledTimes(1);

    // s1 (desabilitado) + s5/s6 (terminais) → zera deadlines dos ativos.
    expect(dealUpdateMany).toHaveBeenCalledTimes(3);
    expect(dealUpdateMany).toHaveBeenCalledWith({
      where: { stageId: "s1", archivedAt: null, lostAt: null },
      data: { slaWarnAt: null, slaDueAt: null },
    });

    // Política congelada do intervalo ABERTO refletida em todos os 4 stages.
    expect(histUpdateMany).toHaveBeenCalledTimes(4);
    expect(histUpdateMany).toHaveBeenCalledWith({
      where: { orgId: "org-1", stageId: "s0", exitedAt: null },
      data: { slaWarnDays: AGING_WARN_DAYS, slaDangerDays: AGING_DANGER_DAYS },
    });
    expect(histUpdateMany).toHaveBeenCalledWith({
      where: { orgId: "org-1", stageId: "s1", exitedAt: null },
      data: { slaWarnDays: null, slaDangerDays: null },
    });
  });
});
