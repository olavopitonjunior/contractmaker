import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

/**
 * A revalidação é o ponto onde a DECLARAÇÃO do slot (no `handlebarsSource`) e a
 * realidade (o token dentro do Google Doc) se reconciliam.
 *
 * Sem isso, as duas pontas divergem em silêncio e a geração erra de dois jeitos:
 * declarado sem token = a cláusula resolvida é descartada e o contrato sai com a
 * garantia chumbada; token sem declaração = `cleanupOrphanPlaceholders` apaga o
 * token e o contrato sai SEM cláusula de garantia.
 *
 * É também o que faz o conserto manual valer (a página de revisão manda o
 * operador escrever `{{slot_garantia}}` no Doc).
 */

vi.mock("@/lib/google/client", () => ({
  isGoogleDocsConfigured: () => true,
}));

const getDocPlainTextMock = vi.fn();
vi.mock("@/lib/google/docs", () => ({
  getDocPlainText: (...args: unknown[]) => getDocPlainTextMock(...args),
}));

import { POST } from "../[id]/validate-gdoc/route";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const getUserOrgMock = getUserOrg as unknown as ReturnType<typeof vi.fn>;
const templateFindUnique = vi.fn();
const templateUpdate = vi.fn();
Object.assign(prisma.contractTemplate, {
  findUnique: templateFindUnique,
  update: templateUpdate,
});

const HEADER = "<!-- engine=google_docs: a fonte é o Google Doc -->";
const DECLARED = `${HEADER}\n<!-- slots: {{slot_garantia}} -->`;

function template(over: Record<string, unknown> = {}) {
  return {
    id: "tpl1",
    orgId: "org1",
    engine: "google_docs",
    googleTemplateDocId: "doc1",
    modalidade: "locacao",
    handlebarsSource: HEADER,
    draftReport: null,
    ...over,
  };
}

const params = { params: { id: "tpl1" } };
const call = () => POST(new Request("http://localhost/x", { method: "POST" }), params);

function updatedSource(): string | undefined {
  return templateUpdate.mock.calls.at(-1)?.[0].data.handlebarsSource as
    | string
    | undefined;
}

describe("POST /api/templates/[id]/validate-gdoc — reconciliação de slot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "u1" } });
    getUserOrgMock.mockResolvedValue({ id: "org1" });
    templateUpdate.mockResolvedValue({});
  });

  it("token escrito à mão no Doc passa a valer — a declaração é criada", async () => {
    templateFindUnique.mockResolvedValue(template());
    getDocPlainTextMock.mockResolvedValue(
      "CLÁUSULA OITAVA - DA GARANTIA\n{{slot_garantia}}\nCLÁUSULA NONA"
    );

    const res = await call();

    expect(res.status).toBe(200);
    expect(updatedSource()).toBe(DECLARED);
  });

  it("token apagado do Doc → a declaração some (não sobra slot fantasma)", async () => {
    templateFindUnique.mockResolvedValue(template({ handlebarsSource: DECLARED }));
    getDocPlainTextMock.mockResolvedValue("Contrato sem token nenhum aqui.");

    await call();

    expect(updatedSource()).toBe(HEADER);
  });

  it("declaração já coerente com o Doc não reescreve o source", async () => {
    templateFindUnique.mockResolvedValue(template({ handlebarsSource: DECLARED }));
    getDocPlainTextMock.mockResolvedValue("texto {{slot_garantia}} texto");

    await call();

    expect(updatedSource()).toBeUndefined();
  });

  it("o slot NÃO é reportado como chave desconhecida", async () => {
    templateFindUnique.mockResolvedValue(template({ handlebarsSource: DECLARED }));
    getDocPlainTextMock.mockResolvedValue("{{slot_garantia}} e {{chave_inventada}}");

    const body = await (await call()).json();

    expect(body.unknown).toContain("chave_inventada");
    expect(body.unknown).not.toContain("slot_garantia");
  });

  it("conserto manual limpa o aviso que travava a ativação", async () => {
    templateFindUnique.mockResolvedValue(
      template({
        draftReport: {
          slots: [
            {
              slot: "garantia",
              applied: false,
              token: null,
              issues: [{ paragraph: "8.1…", reason: "ambiguous" }],
            },
          ],
        },
      })
    );
    getDocPlainTextMock.mockResolvedValue("agora tem {{slot_garantia}} no doc");

    const body = await (await call()).json();

    expect(body.slots).toEqual([
      expect.objectContaining({ applied: true, token: "{{slot_garantia}}", issues: [] }),
    ]);
  });

  it("enquanto o Doc não tiver o token, o aviso PERMANECE", async () => {
    templateFindUnique.mockResolvedValue(
      template({
        draftReport: {
          slots: [{ slot: "garantia", applied: false, token: null, issues: [] }],
        },
      })
    );
    getDocPlainTextMock.mockResolvedValue("continua sem token");

    const body = await (await call()).json();

    expect(body.slots[0].applied).toBe(false);
  });
});
