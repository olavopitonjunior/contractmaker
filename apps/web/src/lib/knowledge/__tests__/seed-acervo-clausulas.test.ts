/**
 * Lógica pura do `scripts/seed-acervo-clausulas.ts` — o CLI que leva o pacote
 * de cláusulas curadas de um tenant pro acervo (`KnowledgeItem` category=clause).
 *
 * O que está sob teste é a parte que decide o ESTADO do acervo: identidade por
 * conjunto de tags, varredura de CPF e o plano create/update/archive+create.
 * A execução (Prisma + Voyage) fica no `main()` e não é exercitada aqui.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  parseCuratedClause,
  loadCuratedPackage,
  tagIdentity,
  sameTagSet,
  scanForCpf,
  planClauseSeed,
  matchesStoredContent,
  buildAgentNotes,
  type CuratedClause,
  type ExistingClauseRow,
} from "../../../../scripts/seed-acervo-clausulas";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function clause(over: Partial<CuratedClause> = {}): CuratedClause {
  return {
    id: "ativa-garantia-caucao",
    title: "Garantia — caução em dinheiro",
    content: "<p>14.1. NA FORMA DO ARTIGO 38, §2º, DA LEI Nº 8.245/1991...</p>",
    tags: ["slot:garantia", "garantia:caucao"],
    file: "/pacote/clausulas/ativa-garantia-caucao.json",
    ...over,
  };
}

function row(over: Partial<ExistingClauseRow> = {}): ExistingClauseRow {
  return {
    id: "ki_1",
    title: "Garantia — caução em dinheiro",
    content: "<p>14.1. NA FORMA DO ARTIGO 38, §2º, DA LEI Nº 8.245/1991...</p>",
    tags: ["slot:garantia", "garantia:caucao"],
    chunkIndex: 0,
    chunkTotal: 1,
    parentId: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

describe("parseCuratedClause", () => {
  it("aceita o shape real do pacote (campos extras inclusos)", () => {
    const parsed = parseCuratedClause(
      {
        id: "ativa-seguro-fianca-too",
        title: "Seguro fiança — TOO Seguros",
        category: "clause",
        subcategory: "garantia",
        groupCode: "GARANTIA",
        tags: ["slot:garantia", "garantia:seguro_fianca", "provider:too"],
        source: "RESIDENCIAL TOO",
        notes: "Só quando a proposta contratar a cobertura.",
        content: "<p>14.1. A PARTE LOCATÁRIA contratou seguro fiança...</p>",
      },
      "/pacote/clausulas/x.json"
    );
    expect(parsed.groupCode).toBe("GARANTIA");
    expect(parsed.file).toBe("/pacote/clausulas/x.json");
  });

  it("recusa cláusula sem tags — sem tag ela nunca casaria com um slot", () => {
    expect(() =>
      parseCuratedClause(
        { id: "x", title: "T", tags: [], content: "conteúdo suficientemente longo" },
        "/x.json"
      )
    ).toThrow(/tags/i);
  });

  it("recusa conteúdo vazio/curto", () => {
    expect(() =>
      parseCuratedClause({ id: "x", title: "T", tags: ["slot:garantia"], content: "" }, "/x.json")
    ).toThrow(/x\.json/);
  });
});

// ---------------------------------------------------------------------------
// Identidade por tags
// ---------------------------------------------------------------------------

describe("tagIdentity / sameTagSet", () => {
  it("é insensível a ordem e a repetição", () => {
    expect(sameTagSet(["b", "a"], ["a", "b", "a"])).toBe(true);
    expect(tagIdentity(["garantia:caucao", "slot:garantia"])).toBe(
      "garantia:caucao|slot:garantia"
    );
  });

  it("distingue conjuntos onde um é subconjunto do outro", () => {
    // Essa é a razão de não usar `hasEvery`: a cláusula de seguro fiança da
    // Porto e a de cobertura de pintura da Porto compartilham 3 tags.
    expect(
      sameTagSet(
        ["slot:garantia", "garantia:seguro_fianca", "provider:porto_seguro"],
        ["slot:garantia", "garantia:seguro_fianca", "provider:porto_seguro", "cobertura:pintura"]
      )
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PII
// ---------------------------------------------------------------------------

describe("scanForCpf", () => {
  it("acha CPF real no conteúdo", () => {
    const hits = scanForCpf([
      clause({ content: "<p>Fiador CPF 123.456.789-01 residente...</p>" }),
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ field: "content", match: "123.456.789-01" });
  });

  it("ignora o placeholder 000.000.000-00", () => {
    expect(scanForCpf([clause({ content: "<p>CPF nº 000.000.000-00</p>" })])).toEqual([]);
  });

  it("NÃO bloqueia CNPJ de PJ — a redação das garantidoras cita o CNPJ delas", () => {
    expect(
      scanForCpf([
        clause({ content: "<p>LOFT SOLUÇÕES FINANCEIRAS S/A, CNPJ 12.345.678/0001-99...</p>" }),
      ])
    ).toEqual([]);
  });

  it("varre também título e notas", () => {
    const hits = scanForCpf([clause({ notes: "conta do cliente 987.654.321-00" })]);
    expect(hits).toHaveLength(1);
    expect(hits[0].field).toBe("notes");
  });
});

// ---------------------------------------------------------------------------
// Plano
// ---------------------------------------------------------------------------

describe("planClauseSeed", () => {
  it("acervo vazio → CREATE", () => {
    const [action] = planClauseSeed([clause()], []);
    expect(action.kind).toBe("create");
    expect(action.archiveIds).toEqual([]);
  });

  it("mesmo conjunto de tags + mesmo título + mesmo conteúdo → UNCHANGED", () => {
    const c = clause();
    const [action] = planClauseSeed([c], [row({ content: c.content })]);
    expect(action.kind).toBe("unchanged");
  });

  it("mesmo título, conteúdo mudou, single-chunk → UPDATE in-place", () => {
    const c = clause();
    const [action] = planClauseSeed([c], [row({ content: "<p>texto antigo qualquer</p>" })]);
    expect(action.kind).toBe("update");
    expect(action.updateId).toBe("ki_1");
    expect(action.archiveIds).toEqual([]);
  });

  it("mesmo conjunto de tags, TÍTULO diferente → ARCHIVE + CREATE", () => {
    const c = clause();
    const [action] = planClauseSeed([c], [row({ title: "Título velho" })]);
    expect(action.kind).toBe("archive_create");
    expect(action.archiveIds).toEqual(["ki_1"]);
    expect(action.reason).toMatch(/título/i);
  });

  it("dois approved no mesmo conjunto de tags → arquiva os dois e recria", () => {
    const c = clause();
    const [action] = planClauseSeed(
      [c],
      [row({ id: "ki_1" }), row({ id: "ki_2", title: "outro" })]
    );
    expect(action.kind).toBe("archive_create");
    expect(action.archiveIds).toEqual(["ki_1", "ki_2"]);
    expect(action.reason).toMatch(/ambíguo/i);
  });

  it("NÃO toca numa cláusula mais específica que compartilha tags", () => {
    // Semeando a de seguro fiança da Porto, a de cobertura de pintura da Porto
    // (mesmas tags + `cobertura:pintura`) tem que ficar viva.
    const c = clause({
      id: "ativa-seguro-fianca-porto-seguro",
      title: "Seguro fiança — Porto Seguro",
      tags: ["slot:garantia", "garantia:seguro_fianca", "provider:porto_seguro"],
    });
    const cobertura = row({
      id: "ki_pintura",
      title: "Cobertura adicional — pintura interna (Porto Seguro)",
      tags: [
        "slot:garantia",
        "garantia:seguro_fianca",
        "provider:porto_seguro",
        "cobertura:pintura",
      ],
    });
    const [action] = planClauseSeed([c], [cobertura]);
    expect(action.kind).toBe("create");
    expect(action.archiveIds).toEqual([]);
  });

  it("ignora linhas-filhas (chunks) ao procurar a identidade", () => {
    const c = clause();
    const child = row({ id: "ki_child", parentId: "ki_parent", chunkIndex: 0, chunkTotal: 3 });
    const [action] = planClauseSeed([c], [child]);
    expect(action.kind).toBe("create");
  });

  it("conteúdo longo é gravado INTEIRO numa row só → UPDATE in-place", () => {
    // 6.6k chars é o tamanho real da cláusula da Loft no pacote da Ativa. Com o
    // chunking antigo ela virava parent-resumo + filhas e o resolver podia
    // injetar 500 chars cortados no contrato.
    const long = "<p>" + "cláusula muito comprida. ".repeat(400) + "</p>";
    const c = clause({ content: long });
    const [action] = planClauseSeed([c], [row({ content: "conteúdo antigo" })]);
    expect(action.chunkCount).toBeGreaterThan(1); // só o EMBEDDING reparte
    expect(action.kind).toBe("update");
    expect(action.updateId).toBe("ki_1");
  });

  it("conteúdo longo inalterado → UNCHANGED (a row única guarda o texto todo)", () => {
    const long = "<p>" + "cláusula muito comprida. ".repeat(400) + "</p>";
    const c = clause({ content: long });
    const [action] = planClauseSeed([c], [row({ content: long })]);
    expect(action.kind).toBe("unchanged");
  });

  it("row LEGADA chunkada é arquivada e recriada como row única", () => {
    const c = clause();
    const parent = row({ content: c.content.slice(0, 500), chunkTotal: 4 });
    const child = row({ id: "ki_child", parentId: "ki_1", chunkIndex: 0, chunkTotal: 4 });
    const [action] = planClauseSeed([c], [parent, child]);
    expect(action.kind).toBe("archive_create");
    expect(action.archiveIds).toEqual(["ki_1"]);
    expect(action.reason).toMatch(/chunks/i);
  });
});

describe("matchesStoredContent", () => {
  it("compara contra o texto normalizado (whitespace na ponta não conta)", () => {
    const c = clause({ content: "  <p>igual</p>  " });
    expect(matchesStoredContent(c, row({ content: "<p>igual</p>" }), [])).toBe(true);
  });

  it("conteúdo longo bate INTEGRALMENTE — nada de comparar preview", () => {
    const long = "<p>" + "cláusula muito comprida. ".repeat(400) + "</p>";
    const c = clause({ content: long });
    expect(matchesStoredContent(c, row({ content: long }), [])).toBe(true);
    // O preview de 500 chars do chunking antigo NÃO conta como "em dia".
    expect(
      matchesStoredContent(c, row({ content: long.slice(0, 500), chunkTotal: 4 }), [])
    ).toBe(false);
  });

  it("row com filhas nunca está 'em dia' — é acervo legado a recriar", () => {
    const c = clause();
    const child = row({ id: "ki_child", parentId: "ki_1", chunkTotal: 2 });
    expect(matchesStoredContent(c, row({ content: c.content }), [child])).toBe(false);
  });
});

describe("buildAgentNotes", () => {
  it("junta proveniência e notas de forma determinística", () => {
    expect(buildAgentNotes(clause({ source: "RESIDENCIAL TOO", notes: "obs" }))).toBe(
      "Origem: RESIDENCIAL TOO\n\nobs"
    );
    expect(buildAgentNotes(clause())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Leitura do pacote
// ---------------------------------------------------------------------------

describe("loadCuratedPackage", () => {
  function writePackage(files: Array<{ name: string; body: unknown }>, index: unknown): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "acervo-"));
    fs.mkdirSync(path.join(root, "clausulas"));
    for (const f of files) {
      fs.writeFileSync(
        path.join(root, "clausulas", f.name),
        JSON.stringify(f.body, null, 2),
        "utf-8"
      );
    }
    fs.writeFileSync(
      path.join(root, "clausulas", "_index.json"),
      JSON.stringify(index, null, 2),
      "utf-8"
    );
    return root;
  }

  const body = {
    id: "a",
    title: "Cláusula A",
    tags: ["slot:garantia", "garantia:caucao"],
    content: "<p>conteúdo suficientemente longo pra passar</p>",
  };
  const entry = {
    id: "a",
    title: "Cláusula A",
    tags: ["slot:garantia", "garantia:caucao"],
    file: "clausulas/a.json",
  };

  it("lê pela raiz do pacote e pela própria pasta clausulas/", () => {
    const root = writePackage([{ name: "a.json", body }], [entry]);
    expect(loadCuratedPackage(root).clauses).toHaveLength(1);
    expect(loadCuratedPackage(path.join(root, "clausulas")).clauses).toHaveLength(1);
  });

  it("falha quando o título do arquivo diverge do índice", () => {
    const root = writePackage(
      [{ name: "a.json", body: { ...body, title: "Outro" } }],
      [entry]
    );
    expect(() => loadCuratedPackage(root)).toThrow(/title diverge/i);
  });

  it("falha quando duas cláusulas dividem o mesmo conjunto de tags", () => {
    const root = writePackage(
      [
        { name: "a.json", body },
        { name: "b.json", body: { ...body, id: "b", title: "Cláusula B" } },
      ],
      [entry, { ...entry, id: "b", title: "Cláusula B", file: "clausulas/b.json" }]
    );
    expect(() => loadCuratedPackage(root)).toThrow(/tags repetido/i);
  });
});
