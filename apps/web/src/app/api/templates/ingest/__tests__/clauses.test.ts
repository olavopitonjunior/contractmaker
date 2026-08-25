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
import {
  canonicalTagSet,
  sameTagSet,
  selectExactTagMatches,
  variantTags,
} from "@/lib/templates/ingest-clauses";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const getUserOrgMock = getUserOrg as unknown as ReturnType<typeof vi.fn>;
const membershipFindFirst = prisma.orgMembership.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const kiUpdateMany = prisma.knowledgeItem.updateMany as unknown as ReturnType<
  typeof vi.fn
>;
const kiFindMany = prisma.knowledgeItem.findMany as unknown as ReturnType<typeof vi.fn>;

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
const CLAUSULA_SEGURO =
  "8.1. A PARTE LOCATÁRIA contratará seguro-fiança locatício junto à seguradora indicada, mantendo-o vigente.";

/** O acervo curado da Ativa: a genérica + as 4 minutas por garantidor. */
const ACERVO_SEGURO_FIANCA = [
  { id: "curada-generica", tags: ["slot:garantia", "garantia:seguro_fianca"] },
  {
    id: "curada-porto",
    tags: ["slot:garantia", "garantia:seguro_fianca", "provider:porto_seguro"],
  },
  {
    id: "curada-tokio",
    tags: ["slot:garantia", "garantia:seguro_fianca", "provider:tokio_marine"],
  },
  {
    id: "curada-pottencial",
    tags: ["slot:garantia", "garantia:seguro_fianca", "provider:pottencial"],
  },
  {
    id: "curada-too",
    tags: ["slot:garantia", "garantia:seguro_fianca", "provider:too"],
  },
  {
    id: "curada-porto-pintura",
    tags: [
      "slot:garantia",
      "garantia:seguro_fianca",
      "provider:porto_seguro",
      "cobertura:pintura",
    ],
  },
];

/** Emula o `hasEvery` do Postgres (SUBCONJUNTO) sobre um acervo em memória. */
function acervoComHasEvery(acervo: typeof ACERVO_SEGURO_FIANCA) {
  return (args: { where?: { tags?: { hasEvery?: string[] } } }) => {
    const required = args?.where?.tags?.hasEvery ?? [];
    return Promise.resolve(
      acervo.filter((row) => required.every((tag) => row.tags.includes(tag)))
    );
  };
}

describe("POST /api/templates/ingest/clauses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "u1" } });
    getUserOrgMock.mockResolvedValue({ id: "org1" });
    membershipFindFirst.mockResolvedValue({ role: "owner" });
    kiUpdateMany.mockResolvedValue({ count: 0 });
    kiFindMany.mockResolvedValue([]);
    let n = 0;
    createRowsMock.mockImplementation(async () => {
      n += 1;
      return { parentId: `ki${n}`, embedTargets: [{ id: `ki${n}`, text: "x" }] };
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

  it("422 quando duas variantes repetem o par (value, provider)", async () => {
    const res = await POST(
      req({
        slot: "garantia",
        sourceName: "Locação",
        variants: [
          { value: "seguro_fianca", provider: "Porto Seguro", content: CLAUSULA_SEGURO },
          { value: "seguro_fianca", provider: "Porto Seguro", content: CLAUSULA_CAUCAO },
        ],
      }) as never
    );
    expect(res.status).toBe(422);
    const { error } = await res.json();
    expect(error).toContain("Seguro fiança");
    expect(error).toContain("Porto Seguro");
    expect(createRowsMock).not.toHaveBeenCalled();
    expect(kiUpdateMany).not.toHaveBeenCalled();
  });

  it("422 quando duas variantes repetem a opção SEM garantidor", async () => {
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
    expect(body.items[0].provider).toBeNull();
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

  it("título default acrescenta o garantidor quando informado", async () => {
    await POST(
      req({
        slot: "garantia",
        sourceName: "Locação residencial",
        variants: [
          { value: "seguro_fianca", provider: "Porto Seguro", content: CLAUSULA_SEGURO },
        ],
      }) as never
    );
    expect(createRowsMock.mock.calls[0][0].title).toBe(
      "Locação residencial — Cláusula de garantia (Seguro fiança — Porto Seguro)"
    );
  });

  it("4 variantes de seguro-fiança com garantidores distintos passam e ganham provider:*", async () => {
    const res = await POST(
      req({
        slot: "garantia",
        sourceName: "Pacote Ativa",
        variants: [
          { value: "seguro_fianca", provider: "Porto Seguro", content: CLAUSULA_SEGURO },
          { value: "seguro_fianca", provider: "Tokio Marine", content: CLAUSULA_SEGURO },
          { value: "seguro_fianca", provider: "Pottencial", content: CLAUSULA_SEGURO },
          { value: "seguro_fianca", provider: "TOO", content: CLAUSULA_SEGURO },
        ],
      }) as never
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.items.map((i: { tags: string[] }) => i.tags)).toEqual([
      ["slot:garantia", "garantia:seguro_fianca", "provider:porto_seguro"],
      ["slot:garantia", "garantia:seguro_fianca", "provider:tokio_marine"],
      ["slot:garantia", "garantia:seguro_fianca", "provider:pottencial"],
      ["slot:garantia", "garantia:seguro_fianca", "provider:too"],
    ]);
    expect(body.items.map((i: { provider: string }) => i.provider)).toEqual([
      "porto_seguro",
      "tokio_marine",
      "pottencial",
      "too",
    ]);
    expect(createRowsMock).toHaveBeenCalledTimes(4);
  });

  it("cláusula GENÉRICA de seguro-fiança não arquiva as curadas com provider:*", async () => {
    kiFindMany.mockImplementation(acervoComHasEvery(ACERVO_SEGURO_FIANCA));

    const res = await POST(
      req({
        slot: "garantia",
        sourceName: "Locação",
        variants: [{ value: "seguro_fianca", content: CLAUSULA_SEGURO }],
      }) as never
    );
    expect(res.status).toBe(201);

    // O `hasEvery` traria as 6 linhas do tipo; só a de conjunto IDÊNTICO cai.
    expect(kiUpdateMany).toHaveBeenCalledTimes(1);
    expect(kiUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["curada-generica"] } },
      data: { status: "archived" },
    });
    const [{ archivedIds }] = (await res.json()).items;
    expect(archivedIds).toEqual(["curada-generica"]);
  });

  it("cláusula de UM garantidor não arquiva a genérica nem a de outro garantidor", async () => {
    kiFindMany.mockImplementation(acervoComHasEvery(ACERVO_SEGURO_FIANCA));

    const res = await POST(
      req({
        slot: "garantia",
        sourceName: "Locação",
        variants: [
          { value: "seguro_fianca", provider: "Porto Seguro", content: CLAUSULA_SEGURO },
        ],
      }) as never
    );
    expect(res.status).toBe(201);
    // `curada-porto-pintura` tem a MESMA base + `cobertura:pintura` → conjunto
    // diferente, fica de pé.
    expect(kiUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["curada-porto"] } },
      data: { status: "archived" },
    });
  });

  it("nada é arquivado quando nenhuma cláusula tem o conjunto exato", async () => {
    kiFindMany.mockImplementation(acervoComHasEvery(ACERVO_SEGURO_FIANCA));

    const res = await POST(
      req({
        slot: "garantia",
        sourceName: "Locação",
        variants: [
          { value: "seguro_fianca", provider: "Loft", content: CLAUSULA_SEGURO },
        ],
      }) as never
    );
    expect(res.status).toBe(201);
    expect(kiUpdateMany).not.toHaveBeenCalled();
    expect(createRowsMock).toHaveBeenCalledTimes(1);
  });

  it("reingerir a MESMA variante arquiva a anterior e cria a nova", async () => {
    kiFindMany.mockImplementation(
      acervoComHasEvery([
        { id: "anterior", tags: ["slot:garantia", "garantia:fiador"] },
        { id: "outra", tags: ["slot:garantia", "garantia:caucao"] },
      ])
    );

    const res = await POST(
      req({
        slot: "garantia",
        sourceName: "Locação",
        variants: [{ value: "fiador", content: CLAUSULA_FIADOR }],
      }) as never
    );
    expect(res.status).toBe(201);
    expect(kiUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["anterior"] } },
      data: { status: "archived" },
    });
    expect(kiFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: "org1",
          category: "clause",
          status: "approved",
          tags: { hasEvery: ["slot:garantia", "garantia:fiador"] },
        }),
      })
    );
    expect(createRowsMock).toHaveBeenCalledTimes(1);
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

describe("ingest-clauses — conjunto exato de tags", () => {
  it("canonicalTagSet normaliza caixa, espaço, ordem e repetição", () => {
    expect(canonicalTagSet([" Slot:Garantia ", "garantia:fiador", "garantia:fiador"])).toEqual(
      ["garantia:fiador", "slot:garantia"]
    );
  });

  it("sameTagSet é igualdade de conjunto, não subconjunto", () => {
    const generica = ["slot:garantia", "garantia:seguro_fianca"];
    const comProvider = [...generica, "provider:porto_seguro"];
    expect(sameTagSet(generica, ["garantia:seguro_fianca", "slot:garantia"])).toBe(true);
    expect(sameTagSet(generica, comProvider)).toBe(false);
    expect(sameTagSet(comProvider, generica)).toBe(false);
  });

  it("selectExactTagMatches ignora candidatos com tags a mais", () => {
    const candidatos = ACERVO_SEGURO_FIANCA;
    expect(
      selectExactTagMatches(candidatos, ["slot:garantia", "garantia:seguro_fianca"])
    ).toEqual(["curada-generica"]);
    expect(
      selectExactTagMatches(candidatos, [
        "provider:porto_seguro",
        "garantia:seguro_fianca",
        "slot:garantia",
      ])
    ).toEqual(["curada-porto"]);
  });

  it("variantTags slugifica o garantidor no formato do acervo", () => {
    expect(variantTags("garantia", "seguro_fianca", "porto_seguro")).toEqual([
      "slot:garantia",
      "garantia:seguro_fianca",
      "provider:porto_seguro",
    ]);
    expect(variantTags("garantia", "fiador", null)).toEqual([
      "slot:garantia",
      "garantia:fiador",
    ]);
  });
});
