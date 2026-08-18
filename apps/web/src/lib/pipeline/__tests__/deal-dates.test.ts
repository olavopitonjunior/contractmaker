import { describe, it, expect } from "vitest";
import {
  deriveDealMilestones,
  serializeDealMilestones,
  toDealCard,
  type DealForCard,
} from "../deal-dates";

const NOW_MS = new Date("2026-08-06T12:00:00Z").getTime();
const d = (iso: string) => new Date(iso);

function baseDeal(overrides: Partial<DealForCard> = {}): DealForCard {
  return {
    id: "d1",
    title: "Cód: 123 — Casa",
    value: 500_000,
    createdAt: d("2026-08-01T00:00:00Z"),
    clientName: "Maria",
    form: {
      id: "f1",
      status: "completo",
      token: "tok",
      createdAt: d("2026-08-01T01:00:00Z"),
      completedAt: d("2026-08-02T00:00:00Z"),
    },
    contracts: [{ id: "c1", version: 1 }],
    envelopes: [],
    commissionCharges: [],
    manager: null,
    ...overrides,
  } as unknown as DealForCard;
}

describe("deriveDealMilestones", () => {
  it("evento real (envelope/cobrança) tem precedência sobre o scalar do Deal", () => {
    const m = deriveDealMilestones({
      contractSignedAt: d("2026-08-03T00:00:00Z"),
      chargeIssuedAt: d("2026-08-04T00:00:00Z"),
      commissionPaidAt: null,
      form: null,
      envelopes: [{ closedAt: d("2026-08-05T00:00:00Z") }],
      commissionCharges: [{ createdAt: d("2026-08-05T12:00:00Z") }],
    });
    expect(m.contractSignedAt).toEqual(d("2026-08-05T00:00:00Z"));
    expect(m.chargeCreatedAt).toEqual(d("2026-08-05T12:00:00Z"));
  });

  it("sem evento real cai no scalar denormalizado (mark-signed manual/legado)", () => {
    const m = deriveDealMilestones({
      contractSignedAt: d("2026-08-03T00:00:00Z"),
      chargeIssuedAt: d("2026-08-04T00:00:00Z"),
      commissionPaidAt: d("2026-08-06T00:00:00Z"),
      form: { createdAt: d("2026-08-01T00:00:00Z"), completedAt: null },
      envelopes: [],
      commissionCharges: [],
    });
    expect(m.contractSignedAt).toEqual(d("2026-08-03T00:00:00Z"));
    expect(m.chargeCreatedAt).toEqual(d("2026-08-04T00:00:00Z"));
    expect(m.formOpenedAt).toEqual(d("2026-08-01T00:00:00Z"));
    expect(m.formCompletedAt).toBeNull();
    expect(m.commissionPaidAt).toEqual(d("2026-08-06T00:00:00Z"));
  });

  it("serializeDealMilestones devolve ISO ou null", () => {
    const s = serializeDealMilestones({
      contractSignedAt: null,
      chargeIssuedAt: null,
      commissionPaidAt: null,
      form: { createdAt: d("2026-08-01T00:00:00Z"), completedAt: null },
      envelopes: [],
      commissionCharges: [],
    });
    expect(s.formOpenedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(s.formCompletedAt).toBeNull();
    expect(s.contractSignedAt).toBeNull();
  });
});

describe("toDealCard — slaStatus/daysInStage no server", () => {
  it("usa slaWarnAt/slaDueAt materializados quando presentes", () => {
    const card = toDealCard(
      baseDeal({
        stageEnteredAt: d("2026-08-04T12:00:00Z"),
        slaWarnAt: d("2026-08-05T12:00:00Z"),
        slaDueAt: d("2026-08-14T12:00:00Z"),
      } as Partial<DealForCard>),
      NOW_MS,
      "Confecção de Contrato"
    );
    expect(card.slaStatus).toBe("atencao");
    expect(card.daysInStage).toBe(2);
  });

  it("fallback pré-backfill: sem deadlines usa defaults 5/10 sobre daysInStage", () => {
    const stale = toDealCard(
      baseDeal({
        createdAt: d("2026-07-20T00:00:00Z"),
        stageEnteredAt: d("2026-07-20T00:00:00Z"),
        slaWarnAt: null,
        slaDueAt: null,
      } as Partial<DealForCard>),
      NOW_MS,
      "Confecção de Contrato"
    );
    expect(stale.slaStatus).toBe("atrasado"); // 17 dias ≥ 10

    const fresh = toDealCard(
      baseDeal({
        stageEnteredAt: d("2026-08-05T00:00:00Z"),
        slaWarnAt: null,
        slaDueAt: null,
      } as Partial<DealForCard>),
      NOW_MS,
      "Confecção de Contrato"
    );
    expect(fresh.slaStatus).toBe("em_dia");
  });

  it("perdido e stage terminal → slaStatus null (sem badge)", () => {
    const lost = toDealCard(
      baseDeal({
        lostAt: d("2026-08-05T00:00:00Z"),
        slaWarnAt: d("2026-08-01T00:00:00Z"),
        slaDueAt: d("2026-08-02T00:00:00Z"),
      } as Partial<DealForCard>),
      NOW_MS,
      "Confecção de Contrato"
    );
    expect(lost.slaStatus).toBeNull();

    const won = toDealCard(
      baseDeal({ slaWarnAt: null, slaDueAt: null } as Partial<DealForCard>),
      NOW_MS,
      "Comissão paga"
    );
    expect(won.slaStatus).toBeNull();
  });

  it("serializa o DTO completo do card (marcos via regra canônica)", () => {
    const card = toDealCard(
      baseDeal({
        envelopes: [{ closedAt: d("2026-08-05T00:00:00Z") }],
        manager: { name: "  João  ", email: "joao@gmail.com" },
      } as Partial<DealForCard>),
      NOW_MS,
      "Contrato assinado"
    );
    expect(card.contractSignedAt).toBe("2026-08-05T00:00:00.000Z");
    expect(card.managerName).toBe("João");
    expect(card.hasContract).toBe(true);
    expect(card.formToken).toBe("tok");
    expect(card.createdAt).toBe("2026-08-01T00:00:00.000Z");
  });
});
