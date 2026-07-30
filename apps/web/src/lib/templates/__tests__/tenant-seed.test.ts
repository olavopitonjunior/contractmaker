/**
 * Trava do template PRÓPRIO do tenant RE/MAX Ativa
 * (`templates/tenants/remax-ativa/proposta_locacao_v1.hbs`).
 *
 * O arquivo é cadastrado por `scripts/seed-tenant-templates.ts` — o operador roda
 * o `--apply` direto contra staging/prod, sem build nem CI no meio. Se o `.hbs`
 * não compilar com o Handlebars REAL do repo (helpers registrados em
 * `lib/render/handlebars.ts`), o erro só apareceria na primeira proposta gerada
 * pela imobiliária. Este teste roda o pipeline de verdade
 * (`buildViaContext` → `renderContratoHTML`) nos dois extremos da ficha:
 * locatário PF sem fiador, e locatário PJ com fiador PJ.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// O setup global stuba `renderContratoHTML` (devolve JSON). Aqui o objeto do
// teste é o HTML real, então usamos o Handlebars de verdade.
vi.unmock("@/lib/render/handlebars");

import { renderContratoHTML } from "@/lib/render/handlebars";
import { buildViaContext } from "@/lib/proposals/render";
import { dadosLocacaoSchema } from "@/lib/forms/validation-locacao";

const TENANT_TEMPLATE = "templates/tenants/remax-ativa/proposta_locacao_v1.hbs";

/** Lê da RAIZ do repo — vitest roda com cwd = apps/web. */
function loadTenantTemplate(): string {
  const candidates = [
    path.join(process.cwd(), "..", "..", TENANT_TEMPLATE),
    path.join(process.cwd(), TENANT_TEMPLATE),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return fs.readFileSync(c, "utf-8");
  }
  throw new Error(`Template do tenant não encontrado: ${TENANT_TEMPLATE}`);
}

/** Locatário PF, garantia caução — a via sem página de fiador. */
const PF_SEM_FIADOR = dadosLocacaoSchema.parse({
  locadores: [
    { tipo_pessoa: "fisica", nome: "José Locador", cpf: "12345678901", cidade: "Piracicaba", uf: "SP" },
  ],
  locatarios: [
    {
      tipo_pessoa: "fisica",
      nome: "Ana Proponente",
      cpf: "98765432100",
      email: "ana@exemplo.com",
      endereco: "Rua das Acácias",
      numero: "45",
      bairro: "Centro",
      cidade: "Piracicaba",
      uf: "SP",
      renda_mensal: 9000,
    },
  ],
  imovel: {
    rua: "Rua das Flores",
    numero: "100",
    bairro: "Vila Rezende",
    cidade: "Piracicaba",
    uf: "SP",
    cep: "13400000",
    descricao: "Apartamento de 2 dormitorios.",
  },
  aluguel: { valor: 2500, iptu_mensal: 180, condominio_mensal: 320, vigencia_meses: 30 },
  garantia: { tipo: "caucao", caucao_meses: 3 },
  assinatura: { cidade: "Piracicaba", uf: "SP", data: "2026-07-30" },
});

/** Locatário PJ com fiador PJ — a combinação que a Ativa não desenhou em PDF. */
const PJ_COM_FIADOR_PJ = dadosLocacaoSchema.parse({
  locadores: [
    { tipo_pessoa: "fisica", nome: "José Locador", cpf: "12345678901", cidade: "Piracicaba", uf: "SP" },
  ],
  locatarios: [
    {
      tipo_pessoa: "juridica",
      razao_social: "Comércio Alfa Ltda",
      cnpj: "12345678000199",
      endereco: "Avenida Independência",
      numero: "900",
      bairro: "Alemães",
      cidade: "Piracicaba",
      uf: "SP",
      faturamento_mensal: 150000,
      representante: {
        nome: "Carla Representante",
        cpf: "11122233344",
        email: "carla@alfa.com",
        mobile_phone: "19999990000",
      },
    },
  ],
  imovel: {
    rua: "Avenida Dois Córregos",
    numero: "77",
    bairro: "Centro",
    cidade: "Piracicaba",
    uf: "SP",
    cep: "13400000",
    kind: "loja",
    descricao: "Loja terrea com vitrine para a avenida.",
  },
  aluguel: { valor: 8000, vigencia_meses: 60 },
  garantia: {
    tipo: "fiador",
    fiador: {
      tipo_pessoa: "juridica",
      razao_social: "Fiadora Beta S/A",
      cnpj: "99888777000166",
      endereco: "Rua do Porto",
      numero: "12",
      cidade: "Piracicaba",
      uf: "SP",
      representante: { nome: "Bruno Fiador", cpf: "55566677788" },
    },
  },
  assinatura: { cidade: "Piracicaba", uf: "SP", data: "2026-07-30" },
});

function render(dataJson: Record<string, unknown>): string {
  return renderContratoHTML(
    loadTenantTemplate(),
    buildViaContext({
      schemaType: "locacao_residencial_v1",
      dataJson,
      hiddenPaths: [],
      via: "completa",
      numero: "42",
    })
  );
}

describe("proposta de locação RE/MAX Ativa (template do tenant)", () => {
  it("locatário PF sem fiador: compila e não deixa placeholder", () => {
    const html = render(PF_SEM_FIADOR as unknown as Record<string, unknown>);

    expect(html).not.toMatch(/\{\{/);
    expect(html.length).toBeGreaterThan(1000);
    expect(html).toContain("Ana Proponente");
    expect(html).toContain("987.654.321-00"); // helper cpf
    expect(html).toContain("R$"); // helper moeda
    expect(html).toContain("Caução");
    // Sem fiador → a 2ª página não é impressa.
    expect(html).not.toContain("ASSINATURA FIADOR");
  });

  it("locatário PJ com fiador PJ: compila, marca comercial e imprime a página do fiador", () => {
    const html = render(PJ_COM_FIADOR_PJ as unknown as Record<string, unknown>);

    expect(html).not.toMatch(/\{\{/);
    expect(html).toContain("PROPOSTA DE LOCAÇÃO PJ");
    expect(html).toContain("Comércio Alfa Ltda");
    expect(html).toContain("12.345.678/0001-99"); // helper cnpj
    expect(html).toContain("Fiadora Beta S/A");
    expect(html).toContain("ASSINATURA FIADOR");
    // Rótulo normalizado (as fichas PF/PJ da Ativa diziam "MORADOR").
    expect(html).toContain("DO(A) FIADOR(A)");
    expect(html).not.toContain("MORADOR");
  });

  it("não usa helper fora do catálogo de lib/render/handlebars.ts", () => {
    // Os 15 de `registerHandlebarsHelpers` + os built-ins do Handlebars. Um
    // helper inventado só falharia em runtime (Handlebars trata nome
    // desconhecido como path e renderiza vazio, sem lançar) — daí a trava.
    const REGISTRADOS = new Set([
      "moeda", "cpf", "cnpj", "cep", "dataExtenso", "extenso", "numero",
      "numeroExtenso", "percentual", "existe", "eq", "gt", "or",
      "temConjuge", "subnum",
      // built-ins
      "if", "unless", "each", "with", "log", "lookup", "else",
    ]);

    // Tira os comentários antes de varrer — o texto livre deles tem parênteses
    // ("CRECI 25319-J") que não são sub-expressão.
    const source = loadTenantTemplate().replace(/\{\{!--[\s\S]*?--\}\}/g, "");
    const usados = new Set<string>();

    for (const [, raw] of source.matchAll(/\{\{~?([^{}]+?)~?\}\}/g)) {
      const body = raw.trim();
      if (body.startsWith(">") || body.startsWith("!")) continue; // partial/comentário

      // Sub-expressões: `(eq a b)`, `(gt x 0)`.
      for (const [, name] of body.matchAll(/\(\s*([a-zA-Z_]\w*)\s/g)) usados.add(name);

      // Posição de helper: primeiro token de um mustache com argumento.
      const head = body.replace(/^[#/^]\s*/, "");
      if (head.startsWith("*")) continue; // decorator `{{#*inline "x"}}`
      const tokens = head.split(/\s+/);
      if (tokens.length > 1 && /^[a-zA-Z_]\w*$/.test(tokens[0])) usados.add(tokens[0]);
    }

    expect(usados.size).toBeGreaterThan(5); // a varredura achou algo
    for (const h of usados) {
      expect(REGISTRADOS.has(h), `helper "${h}" não está registrado`).toBe(true);
    }
  });
});
