/**
 * `noChunk` em `createKnowledgeItemRows` — a linha que separa conteúdo de BUSCA
 * de conteúdo de CONTRATO.
 *
 * Chunkar existe pro RAG: o vetor do Voyage tem janela finita, então um
 * documento longo vira parent-resumo + N filhas embutidas. Só que uma cláusula
 * de SLOT é lida de volta INTEIRA (`resolveClauseSlots` pega uma linha por tag
 * e injeta o `content` dela no contrato). Com chunking, a cláusula da Loft
 * (6660 chars) virava um parent com `content = slice(0, 500)` — um preview
 * cortado no meio da frase — e mais filhas que herdam as MESMAS tags e nascem
 * `approved`. O contrato saía com o preview ou com um pedaço do meio.
 */
import { describe, it, expect, vi } from "vitest";

import { createKnowledgeItemRows, normalizeKnowledgeContent } from "../knowledge";

/** Stub do client de escrita — devolve a `data` recebida + um id. */
function stubDb() {
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: `ki_${create.mock.calls.length}`,
    ...data,
  }));
  return { knowledgeItem: { create } };
}

/** ~6.6k chars: o tamanho real da cláusula da Loft no pacote da Ativa. */
const LONGA = "<p>" + "Cláusula de garantia bastante extensa. ".repeat(170) + "</p>";

const SLOT_TAGS = ["slot:garantia", "garantia:seguro_fianca"];

describe("createKnowledgeItemRows — noChunk", () => {
  it("cláusula de 6.6k com tag `slot:` vira UMA row com o content INTEGRAL", async () => {
    expect(LONGA.length).toBeGreaterThan(6000);
    const db = stubDb();

    const out = await createKnowledgeItemRows(
      {
        orgId: "org1",
        category: "clause",
        title: "Seguro fiança — Loft",
        content: LONGA,
        tags: SLOT_TAGS,
        status: "approved",
      },
      db
    );

    expect(db.knowledgeItem.create).toHaveBeenCalledTimes(1);
    const row = db.knowledgeItem.create.mock.calls[0][0].data;
    expect(row.content).toBe(LONGA);
    expect(row.content.length).toBe(LONGA.length);
    expect(row.chunkTotal).toBe(1);
    expect(row.chunkIndex).toBe(0);
    expect(row.parentId).toBeNull();
    expect(row.status).toBe("approved");
    expect(out.embedTargets).toHaveLength(1);
    expect(out.parentId).toBe("ki_1");
  });

  it("o VETOR usa o texto truncado — truncar a busca é OK, truncar o contrato não", async () => {
    const db = stubDb();
    const out = await createKnowledgeItemRows(
      {
        orgId: "org1",
        category: "clause",
        title: "Seguro fiança — Loft",
        content: LONGA,
        tags: SLOT_TAGS,
      },
      db
    );
    // Um alvo só (a própria row), com texto menor que o content persistido.
    expect(out.embedTargets[0].id).toBe("ki_1");
    expect(out.embedTargets[0].text.length).toBeLessThan(LONGA.length);
    expect(db.knowledgeItem.create.mock.calls[0][0].data.content.length).toBe(LONGA.length);
  });

  it("`noChunk: true` explícito vale mesmo sem tag de slot", async () => {
    const db = stubDb();
    await createKnowledgeItemRows(
      {
        orgId: "org1",
        category: "clause",
        title: "Longa sem tag de slot",
        content: LONGA,
        tags: ["garantia:caucao"],
        noChunk: true,
      },
      db
    );
    expect(db.knowledgeItem.create).toHaveBeenCalledTimes(1);
    expect(db.knowledgeItem.create.mock.calls[0][0].data.content).toBe(LONGA);
  });

  it("REGRESSÃO: documento longo SEM slot segue chunkado (o RAG depende disso)", async () => {
    const db = stubDb();
    const out = await createKnowledgeItemRows(
      {
        orgId: "org1",
        category: "legislation",
        title: "Lei do Inquilinato",
        content: LONGA,
        tags: ["lei"],
      },
      db
    );
    // parent-resumo + filhas.
    expect(db.knowledgeItem.create.mock.calls.length).toBeGreaterThan(2);
    const parent = db.knowledgeItem.create.mock.calls[0][0].data;
    expect(parent.content).toBe(LONGA.slice(0, 500));
    expect(parent.chunkTotal).toBeGreaterThan(1);
    expect(out.embedTargets.length).toBeGreaterThan(1);
  });

  it("conteúdo curto: noChunk grava o mesmo texto que o caminho normal", async () => {
    const curto = "  <p>Cláusula curta.</p>\r\n  ";
    const comSlot = stubDb();
    const semSlot = stubDb();
    await createKnowledgeItemRows(
      { orgId: "o", category: "clause", title: "t", content: curto, tags: SLOT_TAGS },
      comSlot
    );
    await createKnowledgeItemRows(
      { orgId: "o", category: "clause", title: "t", content: curto, tags: ["x"] },
      semSlot
    );
    const a = comSlot.knowledgeItem.create.mock.calls[0][0].data.content;
    const b = semSlot.knowledgeItem.create.mock.calls[0][0].data.content;
    expect(a).toBe(b);
    expect(a).toBe("<p>Cláusula curta.</p>");
  });

  it("normalizeKnowledgeContent aplica a mesma limpeza do chunker", () => {
    expect(normalizeKnowledgeContent("  a\r\nb  ")).toBe("a\nb");
  });

  it("conteúdo vazio ainda estoura (a validação vem antes do noChunk)", async () => {
    await expect(
      createKnowledgeItemRows(
        { orgId: "o", category: "clause", title: "t", content: "   ", tags: SLOT_TAGS },
        stubDb()
      )
    ).rejects.toThrow(/vazio/i);
  });
});
