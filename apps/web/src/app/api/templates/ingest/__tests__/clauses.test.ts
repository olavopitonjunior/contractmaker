import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/auth/impersonation", () => ({
  getEffectiveUserId: vi.fn(async (id: string) => id),
}));

vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

const createRowsMock = vi.fn();
const embedMock = vi.fn();
vi.mock("@/lib/ai/knowledge", () => ({
  createKnowledgeItemRows: (...args: unknown[]) => createRowsMock(...args),
  embedKnowledgeItem: (...args: unknown[]) => embedMock(...args),
}));

import { POST } from "../clauses/route";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const getUserOrgMock = getUserOrg as unknown as ReturnType<typeof vi.fn>;
const membershipFindFirst = prisma.orgMembership.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const kiUpdateMany = prisma.knowledgeItem.updateMany as unknown as ReturnType<
  typeof vi.fn
>;

function req(body: unknown): Request {
  return new Request("http://localhost/api/templates/ingest/clauses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const CLAUSULA_FIADOR =
  "8.1. Para garantir as obrigações assumidas, o FIADOR assume responsabilidade solidária com a PARTE LOCATÁRIA.";
const CLAUSULA_CAUCAO =
  "8.1. Para garantir as obrigações assumidas, a PARTE LOCATÁRIA dá em caução três aluguéis, nos termos do art. 38.";

describe("POST /api/templates/ingest/clauses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "u1" } });
    getUserOrgMock.mockResolvedValue({ id: "org1" });
    membershipFindFirst.mockResolvedValue({ role: "owner" });
    kiUpdateMany.mockResolvedValue({ count: 0 });
    let n = 0;
    createRowsMock.mockImplementation(async () => {
      n += 1;
      return { parentId: `ki${n}`, embedTargets: [{ id: `ki${n}`, content: "x" }] };
    });
  });

  it("401 sem sessão", async () => {
    authMock.mockResolvedValue(null);
    expect((await POST(req({}) as never)).status).toBe(401);
  });

  it("403 para membro comum", async () => {
    membershipFindFirst.mockResolvedValue({ role: "member" });
    expect((await POST(req({}) as never)).status).toBe(403);
  });

  it("400 para payload fora do schema", async () => {
    const res = await POST(
      req({ slot: "inexistente", sourceName: "x", variants: [] }) as never
    );
    expect(res.status).toBe(400);
  });

  it("422 quando duas variantes recebem a MESMA opção do formulário", async () => {
    const res = await POST(
      req({
        slot: "garantia",
        sourceName: "Locação",
        variants: [
          { value: "fiador", content: CLAUSULA_FIADOR },
          { value: "fiador", content: CLAUSULA_CAUCAO },
        ],
      }) as never
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("Fiador");
    expect(createRowsMock).not.toHaveBeenCalled();
  });

  it("grava uma cláusula por variante com o par de tags do slot", async () => {
    const res = await POST(
      req({
        slot: "garantia",
        sourceName: "Locação residencial",
        variants: [
          { value: "fiador", content: CLAUSULA_FIADOR },
          { value: "caucao", content: CLAUSULA_CAUCAO },
        ],
      }) as never
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.items[0].tags).toEqual(["slot:garantia", "garantia:fiador"]);
    expect(body.items[1].tags).toEqual(["slot:garantia", "garantia:caucao"]);

    expect(createRowsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org1",
        category: "clause",
        tags: ["slot:garantia", "garantia:fiador"],
        source: "consolidacao_modelos",
        content: CLAUSULA_FIADOR,
      }),
      expect.anything()
    );
  });

  it("título default nomeia o slot e a opção do formulário", async () => {
    await POST(
      req({
        slot: "garantia",
        sourceName: "Locação residencial",
        variants: [{ value: "seguro_fianca", content: CLAUSULA_CAUCAO }],
      }) as never
    );
    expect(createRowsMock.mock.calls[0][0].title).toBe(
      "Locação residencial — Cláusula de garantia (Seguro fiança)"
    );
  });

  it("reingestão ARQUIVA a cláusula anterior do mesmo par de tags", async () => {
    await POST(
      req({
        slot: "garantia",
        sourceName: "Locação",
        variants: [{ value: "fiador", content: CLAUSULA_FIADOR }],
      }) as never
    );
    expect(kiUpdateMany).toHaveBeenCalledWith({
      where: {
        orgId: "org1",
        category: "clause",
        status: "approved",
        tags: { hasEvery: ["slot:garantia", "garantia:fiador"] },
      },
      data: { status: "archived" },
    });
  });

  it("falha na gravação não deixa nada pela metade", async () => {
    createRowsMock.mockRejectedValue(new Error("db caiu"));
    const res = await POST(
      req({
        slot: "garantia",
        sourceName: "Locação",
        variants: [{ value: "fiador", content: CLAUSULA_FIADOR }],
      }) as never
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("nada foi salvo");
    expect(embedMock).not.toHaveBeenCalled();
  });
});
