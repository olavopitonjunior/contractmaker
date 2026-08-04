import { describe, it, expect } from "vitest";
import {
  defaultValidUntil,
  DEFAULT_PROPOSAL_VALIDITY_DAYS,
  createSchema,
} from "../create-schema";

/** Hora de parede em Brasília (UTC-3 fixo — o Brasil não tem mais DST). */
function brtParts(d: Date) {
  const shifted = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
    min: shifted.getUTCMinutes(),
  };
}

describe("defaultValidUntil", () => {
  it("vence no fim do 7º dia em horário de Brasília", () => {
    // 04/08 09:17 BRT = 12:17Z
    const from = new Date("2026-08-04T12:17:00.000Z");
    const p = brtParts(defaultValidUntil(from));
    expect([p.y, p.m, p.d]).toEqual([2026, 8, 11]);
    expect([p.h, p.min]).toEqual([23, 59]);
  });

  it("usa 7 dias por padrão", () => {
    expect(DEFAULT_PROPOSAL_VALIDITY_DAYS).toBe(7);
    const from = new Date("2026-08-04T12:17:00.000Z");
    expect(defaultValidUntil(from).getTime()).toBe(
      defaultValidUntil(from, DEFAULT_PROPOSAL_VALIDITY_DAYS).getTime()
    );
  });

  it("não escorrega um dia quando a criação é de madrugada em Brasília", () => {
    // 05/08 00:30 BRT = 03:30Z do dia 05. Ingênuo em UTC daria 12/08; o certo
    // é 12/08 contado a partir do dia 05 em Brasília — mesma coisa aqui, mas
    // o caso simétrico abaixo é o que pega o bug.
    const p = brtParts(defaultValidUntil(new Date("2026-08-05T03:30:00.000Z")));
    expect([p.m, p.d]).toEqual([8, 12]);
  });

  it("não escorrega um dia quando a criação é à noite em Brasília", () => {
    // 04/08 21:00 BRT = 05/08 00:00Z. Contar em UTC daria 12/08 (errado):
    // pro corretor ainda é dia 04, então o 7º dia é 11/08.
    const p = brtParts(defaultValidUntil(new Date("2026-08-05T00:00:00.000Z")));
    expect([p.m, p.d]).toEqual([8, 11]);
  });

  it("atravessa virada de mês e de ano", () => {
    expect(brtParts(defaultValidUntil(new Date("2026-08-28T15:00:00.000Z")))).toMatchObject({
      m: 9,
      d: 4,
    });
    expect(brtParts(defaultValidUntil(new Date("2026-12-28T15:00:00.000Z")))).toMatchObject({
      y: 2027,
      m: 1,
      d: 4,
    });
  });

  it("produz um instante que a rota consegue gravar (ISO válido, no futuro)", () => {
    const v = defaultValidUntil();
    expect(Number.isNaN(v.getTime())).toBe(false);
    expect(v.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("createSchema — o contrato que o agente precisa cumprir", () => {
  it("aceita proposta sem validUntil (o agente não deve perguntar prazo)", () => {
    const r = createSchema.safeParse({
      title: "Proposta — Rua X, 100",
      schemaType: "compra_venda_v1",
      signers: [{ role: "proponente", name: "Fulano", phone: "11999999999" }],
    });
    expect(r.success).toBe(true);
  });

  it("rejeita signatário sem role — a falha real de 04/08", () => {
    const r = createSchema.safeParse({
      title: "Proposta",
      schemaType: "compra_venda_v1",
      signers: [{ name: "Fulano", email: "f@x.com" }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].path).toEqual(["signers", 0, "role"]);
    }
  });

  it("rejeita validUntil com offset em vez de UTC", () => {
    const base = { title: "P", schemaType: "compra_venda_v1" as const };
    expect(createSchema.safeParse({ ...base, validUntil: "2026-08-11T23:59:59-03:00" }).success).toBe(
      false
    );
    expect(createSchema.safeParse({ ...base, validUntil: "2026-08-11" }).success).toBe(false);
    expect(
      createSchema.safeParse({ ...base, validUntil: "2026-08-11T23:59:59.999Z" }).success
    ).toBe(true);
  });
});
