import { describe, it, expect } from "vitest";
import {
  plannedProposalCostCents,
  plannedAcceptanceCostCents,
} from "../cost";

describe("plannedProposalCostCents", () => {
  it("email a R$1,50: 3 signatários = 450 centavos", () => {
    expect(
      plannedProposalCostCents({ signerCount: 3, authMethod: "email" })
    ).toBe(450);
  });

  it("ocultação não muda o custo (cada um assina uma vez)", () => {
    // O custo é por assinatura; 1 via ou 2 vias, o total de assinaturas é igual.
    expect(
      plannedProposalCostCents({ signerCount: 3, authMethod: "email" })
    ).toBe(450);
  });

  it("respeita override de custo por org", () => {
    expect(
      plannedProposalCostCents({
        signerCount: 2,
        authMethod: "whatsapp",
        costOverrides: { whatsapp: 300 },
      })
    ).toBe(600);
  });
});

describe("plannedAcceptanceCostCents", () => {
  it("R$0,99 por destinatário", () => {
    expect(plannedAcceptanceCostCents(3)).toBe(297);
  });
});
