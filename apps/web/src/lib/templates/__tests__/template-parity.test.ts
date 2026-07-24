import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Render real (setup.ts mocka renderContratoHTML globalmente).
vi.unmock("@/lib/render/handlebars");

import { enrichContractData } from "@/lib/services/contract-generation";
import { DEFAULT_CONTRACT_SETTINGS } from "@/lib/contracts/default-config";
import { enrichLocacaoData } from "@/lib/locacao/enrich";
import { renderContratoHTML } from "@/lib/render/handlebars";
import { dealDataToSigners } from "@/lib/clicksign/mapping";
import {
  previewSampleDataAVista,
  previewSampleDataFinanciamento,
  previewSampleDataLocacao,
  previewSampleDataLocacaoComercial,
} from "@/lib/templates/preview-sample-data";

/**
 * A0.1 — Parity test form↔template (anti-recorrência, QA deal 20486).
 *
 * Renderiza cada template v2 contra a sample data COMPLETA (mesmo shape do form,
 * cobrindo todas as condicionais) passando por `enrichContractData`, e exige
 * que NÃO sobre nenhum `{{...}}` no HTML final. Se alguém adicionar um
 * `{{config.novaVar}}` ao template sem fonte no form nem no enrich (foi
 * exatamente o caso de `config.municipio_imovel`/`config.data_assinatura`),
 * a variável vaza como `{{...}}` literal e este teste FALHA no CI — antes de
 * subir pra produção.
 */
function templatePath(filename: string): string {
  // vitest roda com cwd = apps/web → repo/templates fica em ../../templates
  // (mesma resolução de scripts/sync-templates.ts).
  const candidates = [
    path.join(process.cwd(), "..", "..", "templates", filename),
    path.join(process.cwd(), "templates", filename),
  ];
  for (const c of candidates) {
    try {
      readFileSync(c);
      return c;
    } catch {
      /* try next */
    }
  }
  throw new Error(`Template não encontrado: ${filename}`);
}

function leftoverMustaches(html: string): string[] {
  return Array.from(new Set(html.match(/\{\{[^{}]+\}\}/g) ?? []));
}

describe("template parity (A0.1)", () => {
  it("CCV À Vista: nenhuma variável de template fica sem fonte", () => {
    const tpl = readFileSync(templatePath("ccv_a_vista_v2.hbs"), "utf-8");
    const enriched = enrichContractData(
      JSON.parse(JSON.stringify(previewSampleDataAVista))
    );
    const html = renderContratoHTML(tpl, enriched as Record<string, unknown>);
    const leftover = leftoverMustaches(html);
    expect(leftover, `Variáveis sem fonte no template à vista: ${leftover.join(", ")}`).toEqual([]);
  });

  it("CCV Financiamento: nenhuma variável de template fica sem fonte", () => {
    const tpl = readFileSync(templatePath("ccv_financiamento_v2.hbs"), "utf-8");
    const enriched = enrichContractData(
      JSON.parse(JSON.stringify(previewSampleDataFinanciamento))
    );
    const html = renderContratoHTML(tpl, enriched as Record<string, unknown>);
    const leftover = leftoverMustaches(html);
    expect(leftover, `Variáveis sem fonte no template financiamento: ${leftover.join(", ")}`).toEqual([]);
  });

  it.each([
    ["locacao_residencial_v3.hbs", previewSampleDataLocacao],
    ["locacao_comercial_v3.hbs", previewSampleDataLocacaoComercial],
  ])("%s: nenhuma variável de template fica sem fonte", (file, sample) => {
    const tpl = readFileSync(templatePath(file), "utf-8");
    const enriched = enrichLocacaoData(JSON.parse(JSON.stringify(sample)));
    const html = renderContratoHTML(tpl, enriched as Record<string, unknown>);
    const leftover = leftoverMustaches(html);
    expect(leftover, `Variáveis sem fonte no template ${file}: ${leftover.join(", ")}`).toEqual([]);
  });

  // Quem assina TEM que ser quem o contrato qualifica. Cada camada tinha a sua
  // lista literal de rótulos de estado civil, e elas discordavam: com "União
  // estável" (minúsculo — o que os prompts do Gemini pedem ao OCR) o cônjuge
  // recebia um CCV real da ClickSign para assinar um documento em que não era
  // qualificado nem tinha linha de assinatura. Hoje as duas pontas consultam
  // `isExplicitlyUnmarried`, o template via helper `temConjuge`.
  it.each([
    undefined,
    "Casado(a)",
    "União Estável",
    "União estável",
    "Uniao Estavel",
    "Outro",
    "Solteiro(a)",
    "Divorciado(a)",
    "Viúvo(a)",
    "viúva",
  ])("estado_civil=%s: mapper e template concordam sobre o cônjuge", (estado_civil) => {
    const parte = {
      tipo_pessoa: "fisica",
      nome: "Odair",
      cpf: "11144477735",
      email: "odair@x.com",
      estado_civil,
      conjuge: { nome: "Elenira", cpf: "52998224725", email: "elenira@x.com" },
    };
    const { signers } = dealDataToSigners({ vendedores: [parte], compradores: [] });
    const assina = signers.some((s) => s.subKind === "conjuge");

    const tpl = readFileSync(templatePath("ccv_a_vista_v2.hbs"), "utf-8");
    const html = renderContratoHTML(tpl, {
      vendedores: [parte],
      compradores: [],
      imoveis: [],
      pagamento: {},
      comissao: {},
      config: {},
    } as Record<string, unknown>);

    expect(assina, `assina=${assina}, no contrato=${html.includes("Elenira")}`).toBe(
      html.includes("Elenira")
    );
  });

  // Outorga uxória em locação (2026-07-24). O `leftoverMustaches` acima não
  // pegaria a ausência: Handlebars renderiza bloco não-satisfeito como string
  // vazia — HTML limpo, CI verde, contrato sem a anuência do cônjuge.
  it("locacao_residencial_v3: cônjuge de parte casada aparece na qualificação e nas assinaturas", () => {
    const tpl = readFileSync(templatePath("locacao_residencial_v3.hbs"), "utf-8");
    const enriched = enrichLocacaoData(
      JSON.parse(JSON.stringify(previewSampleDataLocacao))
    );
    const html = renderContratoHTML(tpl, enriched as Record<string, unknown>);

    // Locatário "Casado(a)" com cônjuge preenchido na sample.
    expect(html).toContain("casado(a) com Beatriz Almeida Nogueira");
    expect(html).toContain("CÔNJUGE DA PARTE LOCATÁRIA");
    // Locadora "Viúvo(a)" e PJ não geram outorga.
    expect(html).not.toContain("CÔNJUGE DA PARTE LOCADORA");
  });

  // Form novo NÃO manda mais foro/config/desistencia/assinatura: esses campos
  // saíram da última etapa e viraram padrão da org, aplicado por
  // `enrichContractData`. Estes casos simulam esse dataJson e provam que o
  // fallback do enrich cobre o buraco.
  //
  // Os `leftoverMustaches` dos testes acima NÃO pegariam isso: Handlebars
  // renderiza `undefined` como string vazia, então um `config` faltando sai
  // como "multa de %" — HTML limpo, CI verde, contrato quebrado.
  it.each([
    ["ccv_a_vista_v2.hbs", previewSampleDataAVista],
    ["ccv_financiamento_v2.hbs", previewSampleDataFinanciamento],
  ])(
    "%s: dataJson sem foro/config/desistencia/assinatura ainda renderiza íntegro",
    (file, sample) => {
      const tpl = readFileSync(templatePath(file), "utf-8");
      const semConfig = JSON.parse(JSON.stringify(sample)) as Record<string, unknown>;
      delete semConfig.foro;
      delete semConfig.desistencia;
      delete semConfig.assinatura;
      delete semConfig.config;

      const enriched = enrichContractData(semConfig);
      const html = renderContratoHTML(tpl, enriched as Record<string, unknown>);

      expect(leftoverMustaches(html)).toEqual([]);
      // Sintomas de campo ausente: percentual/valor órfãos e fecho vazio.
      expect(html).not.toMatch(/\bde\s*%/);
      expect(html).not.toMatch(/<p>\s*,\s*\.?\s*<\/p>/);
      // Padrão de fábrica aplicado onde o template REALMENTE lê config.
      expect(enriched).toMatchObject({ foro: "arbitragem" });
    }
  );

  it("padrão da org troca a cláusula de foro na geração", () => {
    // `foro` é o caso mais forte: não é um valor interpolado, é um `{{#if}}`
    // que troca a cláusula inteira (arbitragem × justiça comum).
    const tpl = readFileSync(templatePath("ccv_a_vista_v2.hbs"), "utf-8");
    const semConfig = JSON.parse(
      JSON.stringify(previewSampleDataAVista)
    ) as Record<string, unknown>;
    delete semConfig.foro;

    const arbitragem = renderContratoHTML(
      tpl,
      enrichContractData(JSON.parse(JSON.stringify(semConfig)), {
        contractDefaults: { ...DEFAULT_CONTRACT_SETTINGS, foro: "arbitragem" },
      }) as Record<string, unknown>
    );
    const justica = renderContratoHTML(
      tpl,
      enrichContractData(JSON.parse(JSON.stringify(semConfig)), {
        contractDefaults: { ...DEFAULT_CONTRACT_SETTINGS, foro: "justica-publica" },
      }) as Record<string, unknown>
    );

    expect(arbitragem).toMatch(/arbitragem/i);
    expect(justica).not.toMatch(/arbitragem/i);
    expect(justica).toMatch(/foro/i);
  });

  it("padrão da org liga a cláusula de desistência", () => {
    const tpl = readFileSync(templatePath("ccv_a_vista_v2.hbs"), "utf-8");
    const base = JSON.parse(JSON.stringify(previewSampleDataAVista)) as Record<
      string,
      unknown
    >;
    delete base.desistencia;
    delete base.config;

    const semDesistencia = renderContratoHTML(
      tpl,
      enrichContractData(JSON.parse(JSON.stringify(base))) as Record<string, unknown>
    );
    const comDesistencia = renderContratoHTML(
      tpl,
      enrichContractData(JSON.parse(JSON.stringify(base)), {
        contractDefaults: {
          ...DEFAULT_CONTRACT_SETTINGS,
          desistencia: { permite: true, prazo_dias: 15 },
        },
      }) as Record<string, unknown>
    );

    expect(semDesistencia).not.toMatch(/desist/i);
    expect(comDesistencia).toMatch(/desist/i);
    expect(comDesistencia).toContain("15");
  });

  it("valor já gravado no dataJson vence o padrão (enrich é aditivo)", () => {
    const comConfig = JSON.parse(
      JSON.stringify(previewSampleDataAVista)
    ) as Record<string, unknown>;
    comConfig.foro = "justica-publica";
    comConfig.config = {
      ...(comConfig.config as Record<string, unknown>),
      multa_penal_moratoria: 7,
    };

    const enriched = enrichContractData(comConfig, {
      contractDefaults: {
        ...DEFAULT_CONTRACT_SETTINGS,
        foro: "arbitragem",
        config: { ...DEFAULT_CONTRACT_SETTINGS.config, multa_penal_moratoria: 3 },
      },
    }) as Record<string, unknown>;

    // O que o negócio definiu não é sobrescrito pelo padrão da org.
    expect(enriched.foro).toBe("justica-publica");
    expect((enriched.config as Record<string, unknown>).multa_penal_moratoria).toBe(7);
  });

  it("os campos de config são lidos pelos templates (não voltar a hardcodar)", () => {
    // Estes números viviam escritos à mão nas cláusulas e os campos do form
    // eram inertes. Agora a aba Configurações depende deles serem variáveis —
    // se alguém "simplificar" um de volta pra literal, o campo some da prática
    // sem nenhum erro visível. Daí o teste.
    const PARAMETRIZADOS = [
      "config.multa_penal_moratoria",
      "config.base_calculo_multa",
      "config.juros_mensais_atraso",
      "config.atualizacao_monetaria",
      "config.prazo_atraso_rescisao",
      "config.multa_cominatoria_diaria",
      "config.multa_penal_compensatoria",
      "config.prazo_multa_rescisoria",
    ];
    const aVista = readFileSync(templatePath("ccv_a_vista_v2.hbs"), "utf-8");
    for (const campo of PARAMETRIZADOS) {
      expect(aVista, `ccv_a_vista_v2.hbs deixou de usar ${campo}`).toContain(campo);
    }

    // O financiamento não tem cláusula de multa cominatória diária nem base de
    // cálculo separada — o resto vale igual.
    const fin = readFileSync(templatePath("ccv_financiamento_v2.hbs"), "utf-8");
    for (const campo of [
      "config.multa_penal_moratoria",
      "config.juros_mensais_atraso",
      "config.prazo_atraso_rescisao",
      "config.multa_penal_compensatoria",
      "config.prazo_multa_rescisoria",
    ]) {
      expect(fin, `ccv_financiamento_v2.hbs deixou de usar ${campo}`).toContain(campo);
    }
  });

  it("À Vista: fecho com local E data preenchidos (regressão F1)", () => {
    const tpl = readFileSync(templatePath("ccv_a_vista_v2.hbs"), "utf-8");
    const enriched = enrichContractData(
      JSON.parse(JSON.stringify(previewSampleDataAVista))
    );
    const html = renderContratoHTML(tpl, enriched as Record<string, unknown>);
    // não deve haver fecho vazio "<p>, .</p>"
    expect(/<p>\s*,\s*\.?\s*<\/p>/.test(html)).toBe(false);
    expect(html).toMatch(/São Paulo\/SP,\s*19 de maio de 2026\./);
  });

  // Guarda-trilho de fidelidade form→contrato: email/telefone das partes e
  // corretores + SQL do imóvel coletados no form devem sair no contrato.
  // (Regressão: esses campos eram coletados mas nunca renderizados.)
  it.each([
    ["ccv_a_vista_v2.hbs", previewSampleDataAVista],
    ["ccv_financiamento_v2.hbs", previewSampleDataFinanciamento],
  ])("%s: renderiza email, telefone e SQL coletados no form", (file, sample) => {
    const tpl = readFileSync(templatePath(file), "utf-8");
    const enriched = enrichContractData(JSON.parse(JSON.stringify(sample)));
    const html = renderContratoHTML(tpl, enriched as Record<string, unknown>);

    // Email dos titulares PF (vendedor + comprador)
    expect(html).toContain("joao.silva@example.com");
    expect(html).toContain("carlos.almeida@example.com");
    // Email + telefone dos cônjuges
    expect(html).toContain("maria.santos@example.com");
    expect(html).toContain("(11) 98888-2222");
    // Email + telefone do representante da parte PJ
    expect(html).toContain("ana.ribeiro@example.com");
    expect(html).toContain("(11) 98888-3333");
    // Telefone dos titulares PF
    expect(html).toContain("(11) 98888-1111");
    expect(html).toContain("(11) 97777-1111");
    // Email + telefone do corretor (loop de comissionados)
    expect(html).toContain("roberto.carvalho@example.com");
    expect(html).toContain("(11) 96666-1111");
    // SQL do imóvel
    expect(html).toContain("045.123.0099-1");
  });
});
