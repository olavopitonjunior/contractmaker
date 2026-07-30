/**
 * Ingestão de documento na base de conhecimento.
 *
 * Foco: a criação das N cláusulas é TUDO OU NADA. O loop solto deixava as
 * cláusulas 1..k-1 gravadas (e sem embedding, que só sai em lote no fim) quando
 * a k-ésima falhava — e o retry do operador duplicava as que já tinham entrado.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/auth/impersonation", () => ({
  getEffectiveUserId: vi.fn().mockResolvedValue("u1"),
}));
vi.mock("@/lib/extraction/docx", () => ({
  extractDocx: vi.fn(),
}));
vi.mock("@/lib/ai/ocr", () => ({ extractPlainText: vi.fn() }));
vi.mock("@/lib/knowledge/upload-classifier", () => ({
  classifyKnowledgeUpload: vi.fn(),
}));
vi.mock("@/lib/knowledge/clause-segmenter", () => ({
  segmentClauses: vi.fn(),
}));
vi.mock("@/lib/ai/embeddings", () => ({
  embed: vi.fn().mockResolvedValue([]),
  toPgVector: vi.fn(() => "[]"),
  isEmbeddingsConfigured: vi.fn().mockReturnValue(false),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

import { POST } from "../route";
import { extractDocx } from "@/lib/extraction/docx";
import { classifyKnowledgeUpload } from "@/lib/knowledge/upload-classifier";
import { segmentClauses } from "@/lib/knowledge/clause-segmenter";

type MockFn = ReturnType<typeof vi.fn>;
const authMock = auth as unknown as MockFn;
const orgMock = getUserOrg as unknown as MockFn;
const docxMock = extractDocx as unknown as MockFn;
const classifyMock = classifyKnowledgeUpload as unknown as MockFn;
const segmentMock = segmentClauses as unknown as MockFn;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;

/** DOCX válido só precisa do magic header PK\x03\x04 pro sniff da rota. */
function docxFile(): File {
  const bytes = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from("conteudo"),
  ]);
  return new File([bytes], "Clausulas.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

function req(): NextRequest {
  const fd = new FormData();
  fd.set("file", docxFile());
  return new NextRequest("http://localhost/api/knowledge/upload", {
    method: "POST",
    body: fd,
  });
}

/**
 * `$transaction` com semântica real de commit/rollback: o que a callback escreve
 * fica em `staged` e só é promovido pra `committed` se ela retornar. Sem isto o
 * mock global comitaria tudo e o teste de atomicidade não provaria nada.
 */
function transactionalStore() {
  const committed: Array<Record<string, unknown>> = [];
  const txCreate = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p.$transaction = vi.fn(async (cb: any) => {
    const staged: Array<Record<string, unknown>> = [];
    const tx = {
      knowledgeItem: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: vi.fn(async (args: any) => {
          txCreate(args);
          staged.push(args.data);
          return { id: `k${staged.length}` };
        }),
      },
    };
    const result = await cb(tx);
    committed.push(...staged); // só chega aqui se a callback não lançou
    return result;
  });
  return { committed, txCreate };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "u1" } });
  orgMock.mockResolvedValue({ id: "org-1" });
  p.orgMembership.findFirst = vi.fn().mockResolvedValue({ role: "owner" });
  p.knowledgeItem.create = vi.fn().mockResolvedValue({ id: "k-global" });
  docxMock.mockResolvedValue({ text: "x".repeat(400) });
  classifyMock.mockResolvedValue({
    kind: "clauses",
    confidence: 0.9,
    reason: "coleção",
  });
  segmentMock.mockReturnValue([
    { title: "Cláusula 1", content: "a".repeat(80) },
    { title: "Cláusula 2", content: "b".repeat(80) },
    { title: "Cláusula 3", content: "c".repeat(80) },
  ]);
});

describe("POST /api/knowledge/upload — ingestão de cláusulas", () => {
  it("cria as N cláusulas dentro de UMA transação", async () => {
    const { committed, txCreate } = transactionalStore();

    const res = await POST(req());

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ mode: "clauses", items: 3 });
    expect(p.$transaction).toHaveBeenCalledTimes(1);
    expect(txCreate).toHaveBeenCalledTimes(3);
    expect(committed).toHaveLength(3);
    // Nenhuma escrita escapou da transação.
    expect(p.knowledgeItem.create).not.toHaveBeenCalled();
  });

  it("falha na 3ª cláusula → ZERO rows persistidas e 500 com mensagem clara", async () => {
    const { committed, txCreate } = transactionalStore();
    let n = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p.$transaction = vi.fn(async (cb: any) => {
      const staged: Array<Record<string, unknown>> = [];
      const tx = {
        knowledgeItem: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          create: vi.fn(async (args: any) => {
            txCreate(args);
            if (++n === 3) throw new Error("deadlock");
            staged.push(args.data);
            return { id: `k${staged.length}` };
          }),
        },
      };
      const result = await cb(tx);
      committed.push(...staged);
      return result;
    });

    const res = await POST(req());

    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/nada foi salvo/i);
    expect(txCreate).toHaveBeenCalledTimes(3);
    expect(committed).toHaveLength(0);
    expect(p.knowledgeItem.create).not.toHaveBeenCalled();
  });

  it("documento comum (não-coleção) também grava dentro da transação", async () => {
    classifyMock.mockResolvedValue({
      kind: "other",
      suggestedCategory: "legislation",
      confidence: 0.8,
      reason: "lei",
    });
    const { committed } = transactionalStore();

    const res = await POST(req());

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ mode: "single", category: "legislation" });
    expect(committed.length).toBeGreaterThan(0);
    expect(p.knowledgeItem.create).not.toHaveBeenCalled();
  });
});
