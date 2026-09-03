import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  CLICKSIGN_ROLES,
  CLICKSIGN_ROLE_OPTIONS,
  clicksignRoleLabel,
  defaultRoleForSourceKind,
} from "../roles";
import { leaseDataToSigners } from "../mapping";

/**
 * 2026-09-02 — qualificações nativas de locação na ClickSign v3 (tabela
 * oficial de qualificações): lessor/lessee/surety/guarantor_spouse. Antes
 * locador e locatário iam como "party" e fiador + cônjuge como "consenting".
 */

describe("defaultRoleForSourceKind — locação", () => {
  it.each([
    ["locador", undefined, "lessor"],
    ["locatario", undefined, "lessee"],
    ["fiador", undefined, "surety"],
    ["locador", "titular", "lessor"],
    ["fiador", "representante", "surety"],
    ["fiador", "conjuge", "guarantor_spouse"],
    ["locador", "conjuge", "consenting"],
    ["locatario", "conjuge", "consenting"],
    ["comprador", "procurador", "attorney"],
    ["vendedor", "conjuge", "consenting"],
    ["testemunha", undefined, "witness"],
    ["imobiliaria", "representante", "realestate"],
    ["outro", undefined, "sign"],
  ] as const)("%s/%s → %s", (kind, sub, expected) => {
    expect(defaultRoleForSourceKind(kind, sub as never)).toBe(expected);
  });
});

describe("CLICKSIGN_ROLES — fonte única", () => {
  it("contém as 4 qualificações de locação e o zod derivado aceita todas", () => {
    const schema = z.enum(CLICKSIGN_ROLES);
    for (const r of ["lessor", "lessee", "surety", "guarantor_spouse"]) {
      expect(CLICKSIGN_ROLES).toContain(r);
      expect(schema.safeParse(r).success).toBe(true);
    }
    expect(schema.safeParse("guarantor").success).toBe(false);
  });

  it("dropdown e labels PT-BR cobrem todos os roles", () => {
    const values = CLICKSIGN_ROLE_OPTIONS.map((o) => o.value);
    for (const r of CLICKSIGN_ROLES) expect(values).toContain(r);
    expect(clicksignRoleLabel("surety")).toBe("Fiador");
    expect(clicksignRoleLabel("guarantor_spouse")).toBe("Cônjuge do fiador");
    expect(clicksignRoleLabel("lessor")).toBe("Locador");
    expect(clicksignRoleLabel("lessee")).toBe("Locatário");
    // Role legado persistido em envelopes antigos continua rotulado.
    expect(clicksignRoleLabel("consenting")).toBe("Anuente");
  });
});

describe("leaseDataToSigners + defaults — cada parte com a qualificação própria", () => {
  it("locador, locatário, fiador e cônjuge do fiador", () => {
    const { signers } = leaseDataToSigners({
      locadores: [
        { tipo_pessoa: "fisica", nome: "Ana", cpf: "111.444.777-35", email: "ana@x.com" },
      ],
      locatarios: [
        { tipo_pessoa: "fisica", nome: "Bruno", cpf: "529.982.247-25", email: "b@x.com" },
      ],
      garantia: {
        tipo: "fiador",
        fiador: {
          tipo_pessoa: "fisica",
          nome: "Fiador Fulano",
          cpf: "222.333.444-05",
          email: "fiador@x.com",
          estado_civil: "Casado(a)",
          conjuge: { nome: "Cônjuge do Fiador", cpf: "111.444.777-35", email: "cf@x.com" },
        },
      },
    });
    const roles = signers.map((s) => [
      s.sourceKind,
      s.subKind,
      defaultRoleForSourceKind(s.sourceKind, s.subKind),
    ]);
    expect(roles).toEqual(
      expect.arrayContaining([
        ["locador", "titular", "lessor"],
        ["locatario", "titular", "lessee"],
        ["fiador", "titular", "surety"],
        ["fiador", "conjuge", "guarantor_spouse"],
      ])
    );
  });
});
