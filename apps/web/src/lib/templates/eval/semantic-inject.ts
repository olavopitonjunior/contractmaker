/**
 * Injeção dos defeitos SEMÂNTICOS medidos em produção num texto padronizado
 * limpo — o gabarito da bateria de recall das checagens (`semantic-checks.ts`).
 *
 * Por que injetar em vez de anotar: os 10 rascunhos errados da RE/MAX Trio
 * (03/09/2026) foram corrigidos no próprio Google Docs; o texto com o defeito
 * não existe mais em arquivo. O que existe é o registro do QUE estava errado,
 * item a item, e cada injeção aqui reproduz um desses registros sobre o texto
 * que o planejador produz hoje:
 *
 * - `wrong-entity`     — item a) do rateio chaveado com `{{corretagem_*}}`
 *                        (4 rascunhos: ry7t5z, ogu22h, 73d97y, 16sp1e).
 * - `leftover-creci`   — " inscrito no CRECI sob o nº79.434." literal depois
 *                        da chave do corretor (6 rascunhos).
 * - `leftover-endereco`— endereço da imobiliária literal depois da chave
 *                        (73d97y). A regex de sobrantes da conferência NÃO
 *                        cobria; é o caso mais provável de recall baixo.
 * - `org-literal`      — CNPJ/CRECI da própria imobiliária fixos no texto
 *                        (sugestão registrada na conferência).
 * - `collapsed-list`   — cabeçalho + a) + b) + c) do rateio virando UMA chave
 *                        solta, e o item seguinte citando o número que sumiu
 *                        (favwdx, flahwa, yyuvv4).
 * - `dangling-only`    — só o cabeçalho numerado some; a citação fica.
 *
 * PURO: recebe texto, devolve texto + onde esperar o achado. A pontuação é do
 * script (`scripts/ai-bench/placeholders/semantic-recall.ts`).
 */
import type { SemanticCategory, OrgFacts } from "@/lib/templates/semantic-checks";
import { splitDocParagraphs } from "@/lib/templates/insertion-report";

export type InjectionKind =
  | "wrong-entity"
  | "leftover-creci"
  | "leftover-endereco"
  | "org-literal"
  | "collapsed-list"
  | "dangling-only";

export const INJECTION_KINDS: readonly InjectionKind[] = [
  "wrong-entity",
  "leftover-creci",
  "leftover-endereco",
  "org-literal",
  "collapsed-list",
  "dangling-only",
];

export interface Injection {
  kind: InjectionKind;
  /** Texto com o defeito. */
  text: string;
  /** Índice (em `splitDocParagraphs(text)`) onde o achado é esperado. */
  paragraphIndex: number;
  /** Categoria que a checagem PRECISA reportar naquele parágrafo (±1). */
  expect: SemanticCategory;
  /**
   * Categorias que a injeção também pode legitimamente provocar (a lista de
   * rateio expandida item a item é, por si, `split-list-tokenized`). Não
   * contam como ruído.
   */
  allowed: SemanticCategory[];
}

const RATEIO_TOKEN = "{{rateio_primeiro_aluguel}}";
const ITEM_RE = /^([a-c])\)\s*(R\$\s?[\d.,]+(?:\s*\([^)]{0,160}\))?)/;
const HEADER_NUM_RE = /^(\d+(?:\.\d+){1,3})\.\s/;

interface Rateio {
  /** Índice do cabeçalho numerado ("4.2. O pagamento…") no texto padronizado. */
  headerIndex: number;
  /** Índices dos parágrafos da lista (a chave composta, ou os itens a)–c)). */
  listIndexes: number[];
  /** Valores por item, lidos do ORIGINAL (a chave composta não os tem). */
  amounts: [string, string, string];
  /** Número do cabeçalho ("4.2"), para o teste de citação. */
  headerNumber: string;
}

/**
 * Localiza a cláusula de rateio no texto padronizado: cabeçalho numerado
 * imediatamente antes da chave composta, ou antes do item a) quando a lista
 * ainda está item a item.
 */
function findRateio(simParas: string[], srcParas: string[]): Rateio | null {
  let listStart = simParas.findIndex((p) => p.trim() === RATEIO_TOKEN);
  let listIndexes: number[];
  if (listStart >= 0) {
    listIndexes = [listStart];
  } else {
    listStart = simParas.findIndex((p) => /^a\)\s/.test(p));
    if (listStart < 0) return null;
    listIndexes = [listStart];
    for (const letter of ["b", "c"]) {
      const j = listIndexes[listIndexes.length - 1] + 1;
      if (j < simParas.length && new RegExp(`^${letter}\\)\\s`).test(simParas[j])) listIndexes.push(j);
    }
  }
  const headerIndex = listStart - 1;
  if (headerIndex < 0) return null;
  const header = HEADER_NUM_RE.exec(simParas[headerIndex]);
  if (!header) return null;

  const amounts: string[] = [];
  for (const p of srcParas) {
    const m = ITEM_RE.exec(p);
    if (m && m[1] === String.fromCharCode(97 + amounts.length)) amounts.push(m[2].trim());
    if (amounts.length === 3) break;
  }
  while (amounts.length < 3) amounts.push(`R$ 1.000,00 (mil reais)`);
  return {
    headerIndex,
    listIndexes,
    amounts: amounts as [string, string, string],
    headerNumber: header[1],
  };
}

/** A lista de rateio como os 13 rascunhos "certos" da Trio ficaram antes do R8. */
function expandedList(r: Rateio, a: { qual: string; pag: string; extraA?: string; extraC?: string }): string[] {
  return [
    `a) ${r.amounts[0]}, a ser pago diretamente à imobiliária intermediadora ${a.qual}${a.extraA ?? ""}, como honorários pela intermediação imobiliária na presente locação, por meio ${a.pag};`,
    `b) ${r.amounts[1]}, a ser pago diretamente à corretora intermediadora {{corretagem_qualificacao}}, na conta {{corretagem_dados_pagamento}};`,
    `c) ${r.amounts[2]}, a ser pago diretamente ao corretor intermediador {{corretagem_qualificacao}}, na conta {{corretagem_dados_pagamento}}${a.extraC ?? ""}.`,
  ];
}

function splice(paras: string[], start: number, deleteCount: number, insert: string[]): string[] {
  const out = paras.slice();
  out.splice(start, deleteCount, ...insert);
  return out;
}

/**
 * Aplica UMA injeção sobre o texto padronizado limpo. `null` quando o texto
 * não tem o que a injeção precisa (sem cláusula de rateio, por exemplo) — o
 * script reporta "n/a", nunca um falso zero.
 */
export function inject(
  kind: InjectionKind,
  simText: string,
  sourceText: string,
  org: OrgFacts
): Injection | null {
  const sim = splitDocParagraphs(simText);
  const src = splitDocParagraphs(sourceText);
  const r = findRateio(sim, src);
  if (!r) return null;
  const listLen = r.listIndexes.length;
  const first = r.listIndexes[0];
  const join = (paras: string[]) => paras.join("\n");

  switch (kind) {
    case "wrong-entity": {
      // Item a) com as chaves do CORRETOR — exatamente os 4 rascunhos.
      const items = expandedList(r, { qual: "{{corretagem_qualificacao}}", pag: "{{corretagem_dados_pagamento}}" });
      return {
        kind,
        text: join(splice(sim, first, listLen, items)),
        paragraphIndex: first,
        expect: "wrong-entity",
        allowed: ["split-list-tokenized"],
      };
    }
    case "leftover-creci": {
      const items = expandedList(r, {
        qual: "{{imobiliaria_qualificacao}}",
        pag: "{{imobiliaria_dados_pagamento}}",
        extraC: " inscrito no CRECI sob o nº79.434",
      });
      return {
        kind,
        text: join(splice(sim, first, listLen, items)),
        paragraphIndex: first + 2,
        expect: "leftover-identifier",
        allowed: ["split-list-tokenized"],
      };
    }
    case "leftover-endereco": {
      const items = expandedList(r, {
        qual: "{{imobiliaria_qualificacao}}",
        pag: "{{imobiliaria_dados_pagamento}}",
        extraA: ", com sede na Rua Ribeiro do Vale, nº 514, Brooklin, CEP 04568-001",
      });
      return {
        kind,
        text: join(splice(sim, first, listLen, items)),
        paragraphIndex: first,
        expect: "leftover-identifier",
        allowed: ["split-list-tokenized"],
      };
    }
    case "org-literal": {
      const literal = `${org.legalName ?? "Imobiliária"}, inscrita no CRECI sob nº ${org.creci ?? ""}, CNPJ sob nº ${org.cnpj ?? ""}`;
      const items = expandedList(r, { qual: literal, pag: "{{imobiliaria_dados_pagamento}}" });
      return {
        kind,
        text: join(splice(sim, first, listLen, items)),
        paragraphIndex: first,
        expect: "org-literal",
        allowed: ["split-list-tokenized", "leftover-identifier"],
      };
    }
    case "collapsed-list": {
      // Cabeçalho + lista inteira → uma chave de DADO solta (favwdx/flahwa/yyuvv4).
      return {
        kind,
        text: join(splice(sim, r.headerIndex, 1 + listLen, ["{{corretagem_dados_pagamento}}"])),
        paragraphIndex: r.headerIndex,
        expect: "collapsed-paragraph",
        allowed: ["dangling-reference"],
      };
    }
    case "dangling-only": {
      // Só o cabeçalho some; se alguém cita "item 4.2." adiante, a citação pende.
      const cites = sim.some(
        (p, i) => i !== r.headerIndex && new RegExp(`\\bitem\\s+(?:n[.º°]?\\s*)?${r.headerNumber.replace(/\./g, "\\.")}\\b`, "i").test(p)
      );
      if (!cites) return null;
      const paras = splice(sim, r.headerIndex, 1, []);
      const citing = paras.findIndex((p) =>
        new RegExp(`\\bitem\\s+(?:n[.º°]?\\s*)?${r.headerNumber.replace(/\./g, "\\.")}\\b`, "i").test(p)
      );
      return {
        kind,
        text: join(paras),
        paragraphIndex: citing,
        expect: "dangling-reference",
        allowed: [],
      };
    }
  }
}
