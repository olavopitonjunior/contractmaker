import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { shouldRecordConsent, PRIVACY_POLICY_VERSION } from "../privacy-consent";

/**
 * A regra que decide se a evidência de consentimento é gravada.
 *
 * Existe como módulo compartilhado desde 2026-09-04: vivia dentro da rota de
 * VENDA, e por isso a LOCAÇÃO nunca a teve — o wizard de lá coletava o aceite
 * (a caixa travava o botão "Finalizar") e nunca o enviava, então
 * `SalesForm.privacyAcceptedAt` ficava nulo mesmo com o titular tendo marcado.
 */
describe("shouldRecordConsent", () => {
  const base = {
    isFinalizing: true,
    alreadyAcceptedAt: null as Date | null,
    bodyPrivacyAccepted: true as unknown,
  };

  it("grava no finalize com aceite explícito", () => {
    expect(shouldRecordConsent(base)).toBe(true);
  });

  it("NÃO grava fora do finalize (auto-save não é ato de consentir)", () => {
    expect(shouldRecordConsent({ ...base, isFinalizing: false })).toBe(false);
  });

  it("NÃO regrava quando já existe evidência — a data do consentimento é a primeira", () => {
    expect(
      shouldRecordConsent({ ...base, alreadyAcceptedAt: new Date("2026-01-01") }),
    ).toBe(false);
  });

  // O ponto mais importante do módulo: exigir `=== true`. Um `!== false`
  // fabricaria prova de consentimento que o titular nunca deu — pior do que não
  // ter prova nenhuma, porque PARECE prova.
  it.each([
    ["ausente", undefined],
    ["nulo", null],
    ["string 'true'", "true"],
    ["número 1", 1],
    ["objeto", {}],
    ["false", false],
  ])("NÃO grava com aceite %s — só `=== true` conta", (_rotulo, valor) => {
    expect(shouldRecordConsent({ ...base, bodyPrivacyAccepted: valor })).toBe(false);
  });

  it("a versão da política é uma só, e não vazia", () => {
    expect(PRIVACY_POLICY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

/**
 * Canário de fiação: o wizard de locação precisa ENVIAR `privacyAccepted` no
 * finalize do token principal. O bug original não estava na regra acima — ela
 * sempre esteve certa na venda — e sim no fato de o corpo do PATCH de locação
 * nunca carregar o campo. Um teste da regra sozinho não pegaria isso.
 */
const lerWizard = (): string =>
  readFileSync(
    resolve(process.cwd(), "src/components/forms/LocacaoFormWizard.tsx"),
    "utf8",
  );

describe("fiação do wizard de locação (canário do bug de 2026-09-04)", () => {
  it("o finalize do token principal envia privacyAccepted", () => {
    const fonte = lerWizard();
    // O corpo do PATCH principal tem de conter o campo. Sem ele, a caixa de
    // aceite volta a ser decoração e `privacyAcceptedAt` fica nulo.
    expect(fonte).toMatch(/status:\s*"completo",\s*privacyAccepted/);
  });

  it("CONTROLE: o subtoken NÃO envia — não é ele quem finaliza o formulário", () => {
    const fonte = lerWizard();
    expect(fonte).toMatch(/markCompleted:\s*true\s*\}/);
    expect(fonte).not.toMatch(/markCompleted:\s*true,\s*privacyAccepted/);
  });
});
