import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  resolveProposalSlaPolicies,
  getStuckProposals,
  PROPOSAL_SLA_DEFAULTS,
} from "../funnel";

const slaFindMany = vi.mocked(prisma.slaPolicy.findMany);
const proposalFindMany = vi.mocked(prisma.proposal.findMany);

const NOW = new Date("2026-08-06T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

function mkProposal(over: Record<string, unknown>) {
  return {
    id: "p1",
    title: "Proposta X",
    status: "enviada",
    sentAt: null,
    firstViewedAt: null,
    updatedAt: daysAgo(1),
    createdAt: daysAgo(10),
    convertedDealId: null,
    responsibleName: null,
    responsibleUser: null,
    user: { name: "Ana", email: "ana@gmail.com" },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  slaFindMany.mockResolvedValue([] as never);
  proposalFindMany.mockResolvedValue([] as never);
});

describe("resolveProposalSlaPolicies", () => {
  it("sem linha da org → defaults de código pros 3 status", async () => {
    const policies = await resolveProposalSlaPolicies("org-1");
    expect(policies).toHaveLength(3);
    expect(policies.find((p) => p.key === "enviada")).toMatchObject({
      ...PROPOSAL_SLA_DEFAULTS.enviada,
      source: "default",
      enabled: true,
    });
  });

  it("linha scope=proposal_status sobrepõe o default", async () => {
    slaFindMany.mockResolvedValue([
      { key: "enviada", warnDays: 1, dangerDays: 2, enabled: true },
    ] as never);
    const policies = await resolveProposalSlaPolicies("org-1");
    expect(policies.find((p) => p.key === "enviada")).toMatchObject({
      warnDays: 1,
      dangerDays: 2,
      source: "custom",
    });
  });
});

describe("getStuckProposals", () => {
  it("enviada/entregue ancoram em sentAt; atrasado quando ≥ dangerDays", async () => {
    proposalFindMany.mockResolvedValue([
      mkProposal({ id: "fresh", status: "enviada", sentAt: daysAgo(1) }),
      mkProposal({ id: "warn", status: "entregue", sentAt: daysAgo(4) }),
      mkProposal({ id: "late", status: "enviada", sentAt: daysAgo(8) }),
    ] as never);
    const stuck = await getStuckProposals({ orgId: "org-1", kind: "venda", now: NOW });
    expect(stuck.map((s) => s.id)).toEqual(["late", "warn"]); // fresh fica fora; ordena por idade
    expect(stuck[0].slaStatus).toBe("atrasado");
    expect(stuck[1].slaStatus).toBe("atencao");
  });

  it("assinada_proponente usa régua própria (2/5) ancorada em updatedAt", async () => {
    proposalFindMany.mockResolvedValue([
      mkProposal({
        id: "sig",
        status: "assinada_proponente",
        updatedAt: daysAgo(3),
      }),
    ] as never);
    const stuck = await getStuckProposals({ orgId: "org-1", kind: "venda", now: NOW });
    expect(stuck).toHaveLength(1);
    expect(stuck[0].slaStatus).toBe("atencao"); // 3d ∈ [2, 5)
  });

  it("política desabilitada silencia o status; convertida carrega a ponte", async () => {
    slaFindMany.mockResolvedValue([
      { key: "enviada", warnDays: 3, dangerDays: 7, enabled: false },
    ] as never);
    proposalFindMany.mockResolvedValue([
      mkProposal({ id: "off", status: "enviada", sentAt: daysAgo(30) }),
      mkProposal({
        id: "conv",
        status: "assinada_proponente",
        updatedAt: daysAgo(10),
        convertedDealId: "deal-9",
      }),
    ] as never);
    const stuck = await getStuckProposals({ orgId: "org-1", kind: "venda", now: NOW });
    expect(stuck.map((s) => s.id)).toEqual(["conv"]);
    expect(stuck[0].convertedDealId).toBe("deal-9");
  });
});
