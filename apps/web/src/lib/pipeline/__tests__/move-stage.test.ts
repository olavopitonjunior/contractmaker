import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));

import { moveDealStage } from "../move-stage";
import { audit } from "@/lib/security/audit";
import { AGING_WARN_DAYS, AGING_DANGER_DAYS } from "../stage-config";

const dealFind = prisma.deal.findUnique as unknown as ReturnType<typeof vi.fn>;
const dealUpdate = prisma.deal.update as unknown as ReturnType<typeof vi.fn>;
const stageFind = prisma.pipelineStage.findUnique as unknown as ReturnType<typeof vi.fn>;
const histFindFirst = prisma.dealStageHistory.findFirst as unknown as ReturnType<typeof vi.fn>;
const histCreate = prisma.dealStageHistory.create as unknown as ReturnType<typeof vi.fn>;
const histUpdate = prisma.dealStageHistory.update as unknown as ReturnType<typeof vi.fn>;
const slaFind = prisma.slaPolicy.findFirst as unknown as ReturnType<typeof vi.fn>;
const auditMock = audit as unknown as ReturnType<typeof vi.fn>;

const DEAL = {
  id: "d1",
  stageId: "s1",
  stageEnteredAt: new Date("2026-08-01T00:00:00Z"),
  createdAt: new Date("2026-07-01T00:00:00Z"),
  kind: "venda",
  stage: { id: "s1", name: "Formulário", position: 0 },
  pipeline: { orgId: "org-1", kind: "venda" },
};
const TO_STAGE = {
  id: "s2",
  name: "Confecção de Contrato",
  position: 1,
  pipeline: { orgId: "org-1" },
};

beforeEach(() => {
  vi.clearAllMocks();
  dealFind.mockResolvedValue(DEAL);
  stageFind.mockResolvedValue(TO_STAGE);
  histFindFirst.mockResolvedValue(null);
  histCreate.mockResolvedValue({ id: "h-new" });
  histUpdate.mockResolvedValue({});
  dealUpdate.mockResolvedValue({});
  slaFind.mockResolvedValue(null);
});

describe("moveDealStage", () => {
  it("fecha o intervalo aberto, abre o novo com snapshots e atualiza o deal + SLA", async () => {
    histFindFirst.mockResolvedValue({
      id: "h-open",
      enteredAt: new Date(Date.now() - 3600_000),
    });
    const r = await moveDealStage({ dealId: "d1", toStageId: "s2", reason: "drag" });
    expect(r).toMatchObject({
      moved: true,
      fromStageId: "s1",
      fromStageName: "Formulário",
      toStageName: "Confecção de Contrato",
      historyId: "h-new",
      orgId: "org-1",
    });
    // Fechou o intervalo anterior com duração.
    expect(histUpdate).toHaveBeenCalledWith({
      where: { id: "h-open" },
      data: { exitedAt: expect.any(Date), durationSec: expect.any(Number) },
    });
    // Abriu o novo com snapshots + política congelada (defaults de código).
    expect(histCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stageId: "s2",
          stageName: "Confecção de Contrato",
          stagePosition: 1,
          fromStageId: "s1",
          slaWarnDays: AGING_WARN_DAYS,
          slaDangerDays: AGING_DANGER_DAYS,
          reason: "drag",
        }),
      })
    );
    // Deal atualizado com SLA materializado.
    expect(dealUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "d1" },
        data: expect.objectContaining({
          stageId: "s2",
          stageEnteredAt: expect.any(Date),
          slaWarnAt: expect.any(Date),
          slaDueAt: expect.any(Date),
        }),
      })
    );
    // Audit padronizado (nomes E ids + previousStageId pro reopen legado).
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1" }),
      expect.objectContaining({
        action: "DEAL_STAGE_CHANGE",
        metadata: expect.objectContaining({
          reason: "drag",
          fromStageId: "s1",
          fromStageName: "Formulário",
          toStageId: "s2",
          toStageName: "Confecção de Contrato",
          previousStageId: "s1",
          historyId: "h-new",
        }),
      })
    );
  });

  it("AUTO-CURA: sem intervalo aberto, cria o do stage atual (estimated) antes de mover", async () => {
    histFindFirst.mockResolvedValue(null);
    await moveDealStage({ dealId: "d1", toStageId: "s2", reason: "drag" });
    // 1ª create = intervalo sintético FECHADO do stage atual; 2ª = o novo.
    expect(histCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          stageId: "s1",
          enteredAt: DEAL.stageEnteredAt,
          exitedAt: expect.any(Date),
          reason: "backfill_gap",
          estimated: true,
        }),
      })
    );
    expect(histCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ data: expect.objectContaining({ stageId: "s2" }) })
    );
  });

  it("mesmo stage → no-op (moved:false), sem histórico e sem audit — mas aplica dealData", async () => {
    stageFind.mockResolvedValue({ ...TO_STAGE, id: "s1", name: "Formulário" });
    const r = await moveDealStage({
      dealId: "d1",
      toStageId: "s1",
      reason: "drag",
      dealData: { title: "novo" },
    });
    expect(r.moved).toBe(false);
    expect(histCreate).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
    expect(dealUpdate).toHaveBeenCalledWith({ where: { id: "d1" }, data: { title: "novo" } });
  });

  it("stage TERMINAL zera o SLA (slaWarnAt/slaDueAt null, política null no histórico)", async () => {
    stageFind.mockResolvedValue({ ...TO_STAGE, id: "s9", name: "Negócio perdido" });
    await moveDealStage({ dealId: "d1", toStageId: "s9", reason: "mark_lost" });
    expect(histCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ slaWarnDays: null, slaDangerDays: null }),
      })
    );
    expect(dealUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ slaWarnAt: null, slaDueAt: null }),
      })
    );
  });

  it("política da org (SlaPolicy) sobrepõe os defaults; linha desabilitada desliga o SLA", async () => {
    slaFind.mockResolvedValue({ warnDays: 2, dangerDays: 4, enabled: true });
    await moveDealStage({ dealId: "d1", toStageId: "s2", reason: "drag" });
    expect(histCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ slaWarnDays: 2, slaDangerDays: 4 }),
      })
    );

    vi.clearAllMocks();
    dealFind.mockResolvedValue(DEAL);
    stageFind.mockResolvedValue(TO_STAGE);
    histFindFirst.mockResolvedValue(null);
    histCreate.mockResolvedValue({ id: "h-new" });
    slaFind.mockResolvedValue({ warnDays: 2, dangerDays: 4, enabled: false });
    await moveDealStage({ dealId: "d1", toStageId: "s2", reason: "drag" });
    expect(dealUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ slaWarnAt: null, slaDueAt: null }),
      })
    );
  });

  it("stage de outra org → lança (cross-org guard)", async () => {
    stageFind.mockResolvedValue({ ...TO_STAGE, pipeline: { orgId: "org-2" } });
    await expect(
      moveDealStage({ dealId: "d1", toStageId: "s2", reason: "drag" })
    ).rejects.toThrow(/outra organização/);
  });

  it("auditMetadata do caller sobrepõe o kind padronizado (mark-lost grava kind:'lost')", async () => {
    await moveDealStage({
      dealId: "d1",
      toStageId: "s2",
      reason: "mark_lost",
      auditMetadata: { kind: "lost", reason: "desistiu" },
    });
    expect(auditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({ kind: "lost", reason: "desistiu" }),
      })
    );
  });
});
