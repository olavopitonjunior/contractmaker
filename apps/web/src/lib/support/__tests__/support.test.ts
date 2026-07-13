import { describe, it, expect } from "vitest";
import { describeScreen, ROUTE_MAP } from "../route-map";
import { normalizeQuestion } from "../handoff";
import { isSupportModuleTag, SUPPORT_MODULE_TAGS } from "../constants";
import { isSupportTool, SUPPORT_TOOLS } from "../tools";
import { collectSupportSeedItems } from "../seed";
import { SUPPORT_FAQ } from "../seed-faq";

describe("describeScreen (consciência de tela)", () => {
  it("casa o prefixo mais específico primeiro", () => {
    // /pipeline/locacao deve vencer /pipeline
    const loc = describeScreen("/pipeline/locacao");
    expect(loc.info?.name).toBe("Pipeline de Locação");
    expect(loc.info?.module).toBe("locacao");

    const vendas = describeScreen("/pipeline");
    expect(vendas.info?.name).toBe("Pipeline de Vendas");
    expect(vendas.info?.module).toBe("vendas");
  });

  it("casa rotas com id dinâmico via prefixo", () => {
    const editor = describeScreen("/contracts/cmabc123");
    expect(editor.info?.name).toBe("Editor de contrato");
    expect(editor.prompt).toContain("Tela atual do usuário");
  });

  it("ignora querystring", () => {
    const s = describeScreen("/templates?novo=1");
    expect(s.info?.name).toBe("Modelos de contrato");
  });

  it("retorna vazio pra rota desconhecida", () => {
    const s = describeScreen("/rota-que-nao-existe");
    expect(s.info).toBeNull();
    expect(s.prompt).toBe("");
  });

  it("lida com pathname nulo", () => {
    expect(describeScreen(null).info).toBeNull();
    expect(describeScreen(undefined).prompt).toBe("");
  });
});

describe("normalizeQuestion (dedupe de handoff)", () => {
  it("normaliza acentos, caixa e pontuação", () => {
    expect(normalizeQuestion("Como GERO um contrato?")).toBe("como gero um contrato");
  });

  it("colapsa variações da mesma pergunta na mesma chave", () => {
    const a = normalizeQuestion("Como envio p/ assinatura??");
    const b = normalizeQuestion("como   envio p  assinatura");
    expect(a).toBe(b);
  });

  it("trunca em 300 chars", () => {
    expect(normalizeQuestion("a".repeat(400)).length).toBe(300);
  });
});

describe("guards", () => {
  it("isSupportModuleTag só aceita as tags conhecidas", () => {
    for (const t of SUPPORT_MODULE_TAGS) expect(isSupportModuleTag(t)).toBe(true);
    expect(isSupportModuleTag("financeiro")).toBe(false);
    expect(isSupportModuleTag("")).toBe(false);
  });

  it("isSupportTool reconhece as tools de suporte", () => {
    expect(isSupportTool("search_support_kb")).toBe(true);
    expect(isSupportTool("request_human_handoff")).toBe(true);
    expect(isSupportTool("query_lease_status")).toBe(false);
  });

  it("SUPPORT_TOOLS expõe exatamente as 2 tools esperadas", () => {
    const names = SUPPORT_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(["request_human_handoff", "search_support_kb"]);
  });
});

describe("collectSupportSeedItems (base padrão)", () => {
  const items = collectSupportSeedItems();

  it("cobre FAQ + mapa de telas", () => {
    expect(items.length).toBe(SUPPORT_FAQ.length + ROUTE_MAP.length);
  });

  it("todo item tem source único e ao menos uma tag de módulo", () => {
    const sources = items.map((i) => i.source);
    expect(new Set(sources).size).toBe(sources.length);
    for (const i of items) {
      expect(i.tags.length).toBeGreaterThan(0);
      i.tags.forEach((t) => expect(isSupportModuleTag(t)).toBe(true));
      expect(i.title.length).toBeGreaterThan(2);
      expect(i.content.length).toBeGreaterThan(2);
    }
  });

  it("prefixa sources por origem (faq:/route:)", () => {
    expect(items.some((i) => i.source.startsWith("faq:"))).toBe(true);
    expect(items.some((i) => i.source.startsWith("route:"))).toBe(true);
  });
});
