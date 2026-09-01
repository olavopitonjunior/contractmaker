import { describe, it, expect } from "vitest";
import {
  auditTemplateText,
  parseTemplatePiiReport,
  piiGateMessage,
  TEMPLATE_BLOCKING_PII_KINDS,
  TEMPLATE_WARNING_PII_KINDS,
} from "../pii-gate";

/**
 * Trechos reais (com os dados trocados) do que sobrou literal nos modelos da
 * RE/MAX Trio depois do passe de IA em 2026-09-01 — é o caso que motivou o gate.
 */
const CORRETAGEM =
  "b) R$ 1.315,15, a ser pago diretamente à corretora intermediadora, na conta " +
  "de titularidade corrente, no Banco Nubank 0260, Agência 0001, Conta Corrente " +
  "682331986-6, Chave PIX: 49.441.038/0001-99.";

const QUALIFICACAO_REAL =
  "FULANA DE TAL, brasileira, portadora da cédula de identidade RG nº 34.907.700-X " +
  "e inscrita no CPF/MF sob nº 529.982.247-25, residente na Rua Tal, nº 10.";

const TIMBRE_E_CHAVES =
  "{{locadores_qualificacao}}, residente na {{imovel_endereco_completo}}. " +
  "Administradora: NNI Negócios Imobiliários Ltda, CNPJ 17.641.514/0001-29, " +
  "Rua Roque Petrella, 188, CEP 04581-050, contato@imobiliaria.com.br, (11) 5536-3077. " +
  "RG nº xxxxxx, CPF nº xxxxxxx, conta nº ____________.";

describe("auditTemplateText", () => {
  it("dado bancário de terceiro na corretagem BLOQUEIA", () => {
    const r = auditTemplateText(CORRETAGEM);
    expect(r.blocked).toBe(true);
    expect(r.kinds).toEqual(expect.arrayContaining(["bank_agency", "bank_account"]));
    expect(r.count).toBeGreaterThanOrEqual(2);
  });

  it("CPF e RG de pessoa que a IA não tokenizou BLOQUEIAM", () => {
    const r = auditTemplateText(QUALIFICACAO_REAL);
    expect(r.blocked).toBe(true);
    expect(r.kinds).toEqual(["cpf", "rg"]);
  });

  it("timbre da imobiliária e placeholders NÃO bloqueiam — só avisam", () => {
    const r = auditTemplateText(TIMBRE_E_CHAVES);
    expect(r.blocked).toBe(false);
    expect(r.kinds).toEqual([]);
    expect(r.count).toBe(0);
    // CNPJ/CEP/telefone/e-mail institucionais aparecem no relatório, sem travar.
    expect(r.warnings).toEqual(expect.arrayContaining(["cnpj", "cep"]));
  });

  it("lacunas de minuta (xxxx, ____) e chaves {{…}} não disparam detector", () => {
    const r = auditTemplateText("{{aluguel_valor}} — R$ X.000,00 — RG nº ______ — CPF xxx.xxx.xxx-xx");
    expect(r.blocked).toBe(false);
    expect(r.warnings).toEqual([]);
  });

  it("carimba quando mediu — o relatório vale para ESTE texto", () => {
    const r = auditTemplateText("", new Date("2026-09-01T20:00:00Z"));
    expect(r.checkedAt).toBe("2026-09-01T20:00:00.000Z");
  });

  it("as duas listas não se sobrepõem", () => {
    for (const k of TEMPLATE_BLOCKING_PII_KINDS) {
      expect(TEMPLATE_WARNING_PII_KINDS).not.toContain(k);
    }
  });
});

describe("parseTemplatePiiReport", () => {
  it("modelo legado sem o campo NÃO é bloqueado por isso", () => {
    expect(parseTemplatePiiReport(null)).toBeNull();
    expect(parseTemplatePiiReport({})).toBeNull();
    expect(parseTemplatePiiReport({ inserted: [], slots: [] })).toBeNull();
  });

  it("lê o relatório gravado e tolera campo faltando", () => {
    const r = parseTemplatePiiReport({ pii: { blocked: true, kinds: ["cpf"] } });
    expect(r).toEqual({ blocked: true, kinds: ["cpf"], count: 1, warnings: [], checkedAt: "" });
  });

  it("relatório malformado (blocked não booleano) é ignorado", () => {
    expect(parseTemplatePiiReport({ pii: { blocked: "sim" } })).toBeNull();
    expect(parseTemplatePiiReport({ pii: [] })).toBeNull();
  });
});

describe("piiGateMessage", () => {
  it("nomeia as categorias em português e conta as ocorrências", () => {
    const msg = piiGateMessage({
      blocked: true,
      kinds: ["cpf", "bank_account"],
      count: 3,
      warnings: [],
      checkedAt: "",
    });
    expect(msg).toContain("CPF, conta bancária");
    expect(msg).toContain("3 ocorrências");
    expect(msg).toContain("chave de preenchimento");
  });
});
