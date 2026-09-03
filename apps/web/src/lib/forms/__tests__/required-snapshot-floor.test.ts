import { describe, it, expect, vi } from "vitest";

const findUnique = vi.fn();
vi.mock("@/lib/db/prisma", () => ({
  prisma: { orgFormSettings: { findUnique: (...a: unknown[]) => findUnique(...a) } },
}));

import { resolveFormRequiredConfig } from "../required-snapshot";

/**
 * `moduleConfigured` é o que decide se o PISO do `LocacaoFormWizard` (nome da
 * parte, valor do aluguel) ainda vale. Ele existia para org que nunca
 * configurou nada; org que configurou passa a mandar sozinha, inclusive para
 * AFROUXAR — antes disso a configuração só era respeitada para endurecer, e um
 * campo desmarcado continuava barrando o cliente sem tela capaz de desligá-lo.
 *
 * O caso que não pode quebrar é o primeiro: org SEM configuração continua
 * exatamente como sempre foi.
 */
const LOCACAO = { orgId: "org1", schemaType: "locacao_residencial_v1" as const };

const CUSTOM_ROW = {
  preset: "legado",
  customRequiredPaths: [],
  locacaoPreset: "custom",
  locacaoCustomRequiredPaths: [
    { step: 2, path: "locatarios.0.cpf" },
    { step: 3, path: "imovel.matricula" },
  ],
};

describe("resolveFormRequiredConfig — o piso cede à configuração", () => {
  it("org SEM row de settings mantém o piso (não-regressão)", async () => {
    findUnique.mockResolvedValueOnce(null);
    const cfg = await resolveFormRequiredConfig({ ...LOCACAO, requiredPreset: null });
    expect(cfg.moduleConfigured).toBe(false);
    expect(cfg.byStep.flat()).toEqual([]);
  });

  it("snapshot null e snapshot 'legado' mantêm o piso", async () => {
    findUnique.mockResolvedValueOnce(CUSTOM_ROW);
    expect(
      (await resolveFormRequiredConfig({ ...LOCACAO, requiredPreset: null }))
        .moduleConfigured
    ).toBe(false);

    findUnique.mockResolvedValueOnce(CUSTOM_ROW);
    expect(
      (await resolveFormRequiredConfig({ ...LOCACAO, requiredPreset: "legado" }))
        .moduleConfigured
    ).toBe(false);
  });

  it("snapshot configurado DESLIGA o piso e devolve os paths da org", async () => {
    findUnique.mockResolvedValueOnce(CUSTOM_ROW);
    const cfg = await resolveFormRequiredConfig({
      ...LOCACAO,
      requiredPreset: "custom",
    });
    expect(cfg.moduleConfigured).toBe(true);
    expect(cfg.byStep[2]).toContain("locatarios.0.cpf");
    expect(cfg.byStep[3]).toContain("imovel.matricula");
    // Nada de locador nem de aluguel: é exatamente o que a org configurou.
    expect(cfg.byStep[1]).toEqual([]);
    expect(cfg.byStep[4]).toEqual([]);
  });

  it("controle: 'completo' desliga o piso mas exige MUITO mais que 'custom'", async () => {
    findUnique.mockResolvedValueOnce(CUSTOM_ROW);
    const completo = await resolveFormRequiredConfig({
      ...LOCACAO,
      requiredPreset: "completo",
    });
    expect(completo.moduleConfigured).toBe(true);
    // Sem este controle, um bug que zerasse `byStep` passaria nos casos acima.
    expect(completo.byStep[1].length).toBeGreaterThan(10);
    expect(completo.byStep[4]).toContain("aluguel.valor");
  });

  it("VENDA nunca desliga o piso, mesmo com preset configurado", async () => {
    findUnique.mockResolvedValueOnce({
      preset: "completo",
      customRequiredPaths: [],
      locacaoPreset: "custom",
      locacaoCustomRequiredPaths: [],
    });
    const cfg = await resolveFormRequiredConfig({
      orgId: "org1",
      schemaType: "venda_v1",
      requiredPreset: "custom",
    });
    expect(cfg.moduleConfigured).toBe(false);
    // …e continua resolvendo a obrigatoriedade de venda ao vivo, como sempre.
    expect(cfg.byStep[1]).toContain("vendedores.0.cpf");
  });
});
