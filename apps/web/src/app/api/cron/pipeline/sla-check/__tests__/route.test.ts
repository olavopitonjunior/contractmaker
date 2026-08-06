import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { prisma } from "@/lib/db/prisma";
import { emitNotification } from "@/lib/notifications/emit";
import {
  notifyDealEvent,
  stageChangeDedupeKey,
} from "@/lib/notifications/deal-events";

vi.mock("@/lib/security/cron-auth", () => ({
  requireCronAuth: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/env/staging", () => ({
  isCronAllowedInStaging: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/notifications/emit", () => ({
  emitNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/notifications/deal-events", async (orig) => ({
  ...(await orig<typeof import("@/lib/notifications/deal-events")>()),
  notifyDealEvent: vi.fn().mockResolvedValue(undefined),
}));

const dealFindMany = vi.mocked(prisma.deal.findMany);
const emit = vi.mocked(emitNotification);
const notify = vi.mocked(notifyDealEvent);

function mkDeal(i: number, orgId = "org-1") {
  return {
    id: `d${i}`,
    title: `Negócio ${i}`,
    stageId: "s1",
    slaDueAt: new Date("2026-08-01T00:00:00Z"),
    stage: { name: "Confecção de Contrato" },
    pipeline: { orgId, kind: "venda" },
  };
}

function req() {
  return new NextRequest("http://localhost/api/cron/pipeline/sla-check");
}

beforeEach(() => {
  vi.clearAllMocks();
  dealFindMany.mockResolvedValue([] as never);
});

describe("GET /api/cron/pipeline/sla-check", () => {
  it("sem estouros → nada emitido", async () => {
    const body = await (await GET(req())).json();
    expect(body).toMatchObject({ ok: true, scanned: 0, bells: 0, digests: 0 });
    expect(emit).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("≤5 estouros → 1 sino por deal com batchId dia-BRT + externos via motor", async () => {
    dealFindMany.mockResolvedValue([mkDeal(1), mkDeal(2)] as never);
    const body = await (await GET(req())).json();
    expect(body).toMatchObject({ bells: 2, digests: 0, externalDispatches: 2 });

    const expectedKey = stageChangeDedupeKey("s1");
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "deal_sla_breached",
        orgId: "org-1",
        batchId: `deal-sla-d1-${expectedKey}`,
        linkUrl: "/deals/d1",
        dealId: "d1",
      })
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        dealId: "d1",
        event: "deal_sla_breached",
        dedupeKey: expectedKey,
      })
    );
  });

  it(">5 estouros na org → 1 digest org-wide (sem sinos individuais)", async () => {
    dealFindMany.mockResolvedValue(
      [1, 2, 3, 4, 5, 6].map((i) => mkDeal(i)) as never
    );
    const body = await (await GET(req())).json();
    expect(body).toMatchObject({ bells: 0, digests: 1, externalDispatches: 6 });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "deal_sla_digest",
        title: "6 negócios atrasados (SLA)",
        linkUrl: "/pipeline?sla=atrasado",
      })
    );
  });

  it("deal de locação linka pra /locacao/deals", async () => {
    dealFindMany.mockResolvedValue([
      { ...mkDeal(9), pipeline: { orgId: "org-1", kind: "locacao" } },
    ] as never);
    await GET(req());
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ linkUrl: "/locacao/deals/d9" })
    );
  });

  it("digest é por ORG — orgs pequenas seguem com sinos individuais", async () => {
    dealFindMany.mockResolvedValue(
      [
        ...[1, 2, 3, 4, 5, 6].map((i) => mkDeal(i, "org-big")),
        mkDeal(7, "org-small"),
      ] as never
    );
    const body = await (await GET(req())).json();
    expect(body).toMatchObject({ bells: 1, digests: 1 });
  });
});
