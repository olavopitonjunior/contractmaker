import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { requireAuth } from "@/lib/auth/context";
import { requirePermission, PermissionDeniedError } from "@/lib/security/rbac/guard";
import { getPipelineReport } from "@/lib/pipeline/reports";
import { getFunnelByChannel } from "@/lib/pipeline/funnel";

vi.mock("@/lib/auth/context", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/security/rbac/guard", async (orig) => ({
  ...(await orig<typeof import("@/lib/security/rbac/guard")>()),
  requirePermission: vi.fn(),
}));
vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/pipeline/reports", () => ({ getPipelineReport: vi.fn() }));
vi.mock("@/lib/pipeline/funnel", () => ({ getFunnelByChannel: vi.fn() }));

const auth = vi.mocked(requireAuth);
const perm = vi.mocked(requirePermission);
const report = vi.mocked(getPipelineReport);
const funnel = vi.mocked(getFunnelByChannel);

function req(qs = "") {
  return new NextRequest(`http://localhost/api/relatorios/pipeline/export${qs}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({
    ok: true,
    ctx: { orgId: "org-1", userId: "u-1" },
  } as never);
  perm.mockResolvedValue(undefined as never);
  report.mockResolvedValue({
    stages: [
      {
        stageName: "Formulário",
        stagePosition: 0,
        closedIntervals: 4,
        medianDays: 2.5,
        p90Days: 7,
        withinSlaPct: 75,
        dealsEntered: 10,
        conversionFromPrevPct: null,
      },
    ],
    cycle: { wonDeals: 1, medianDays: 30, p90Days: 60 },
    byBroker: [
      {
        userId: "u-1",
        label: "João",
        total: 3,
        won: 1,
        lost: 1,
        conversionPct: 33,
        totalValue: 1000,
      },
    ],
    estimatedExcluded: 0,
  });
  funnel.mockResolvedValue([]);
});

describe("GET /api/relatorios/pipeline/export", () => {
  it("exige REPORT_EXPORT (403 sem)", async () => {
    perm.mockRejectedValue(new PermissionDeniedError("report.export"));
    const res = await GET(req());
    expect(res.status).toBe(403);
  });

  it("tabela=etapas: CSV pt-BR com BOM, ';' e decimal com vírgula", async () => {
    const res = await GET(req("?kind=venda&periodo=90d&tabela=etapas"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain(
      "pipeline-venda-etapas-90d.csv"
    );
    // res.text() decodifica e DESCARTA o BOM — checa os bytes crus (EF BB BF).
    const bytes = new Uint8Array(await res.clone().arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const text = await res.text();
    expect(text).toContain("Etapa;Passaram;");
    expect(text).toContain("Formulário;10;;4;2,5;7;75");
  });

  it("tabela=corretores usa o relatório; tabela=canais usa o funil", async () => {
    await GET(req("?tabela=corretores"));
    expect(report).toHaveBeenCalled();
    expect(funnel).not.toHaveBeenCalled();

    vi.clearAllMocks();
    perm.mockResolvedValue(undefined as never);
    auth.mockResolvedValue({
      ok: true,
      ctx: { orgId: "org-1", userId: "u-1" },
    } as never);
    funnel.mockResolvedValue([]);
    await GET(req("?tabela=canais"));
    expect(funnel).toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it("tabela/periodo inválidos → 400", async () => {
    expect((await GET(req("?tabela=xpto"))).status).toBe(400);
    expect((await GET(req("?periodo=1y"))).status).toBe(400);
  });
});
