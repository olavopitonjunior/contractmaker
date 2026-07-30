import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

/**
 * F1 (CRÍTICO): a declaração do slot no `handlebarsSource` tem de refletir o que
 * REALMENTE entrou no Google Doc.
 *
 * Declarar um slot que não foi aberto é a pior falha do fluxo: na geração, o
 * `replacePlaceholdersInDoc` não encontra `{{slot_garantia}}` (ele não existe no
 * Doc), a cláusula resolvida some em silêncio e o contrato sai com a garantia
 * chumbada da variante de referência — o cliente escolhe caução e assina fiador.
 */

vi.mock("@/lib/auth/impersonation", () => ({
  getEffectiveUserId: vi.fn(async (id: string) => id),
}));

vi.mock("@/lib/google/client", () => ({
  isGoogleDocsFeatureEnabled: () => true,
}));

const uploadFileAsGoogleDocMock = vi.fn();
vi.mock("@/lib/google/upload-file-as-gdoc", () => ({
  uploadFileAsGoogleDoc: (...args: unknown[]) => uploadFileAsGoogleDocMock(...args),
}));

const insertPlaceholdersMock = vi.fn();
vi.mock("@/lib/templates/ai-placeholder-insertion", () => ({
  insertPlaceholdersWithAI: (...args: unknown[]) => insertPlaceholdersMock(...args),
}));

const applySlotMock = vi.fn();
vi.mock("@/lib/templates/apply-clause-slot", () => ({
  applyClauseSlotToDoc: (...args: unknown[]) => applySlotMock(...args),
}));

import { POST } from "../from-docx/route";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const getUserOrgMock = getUserOrg as unknown as ReturnType<typeof vi.fn>;
const membershipFindFirst = prisma.orgMembership.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const templateFindFirst = prisma.contractTemplate.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const templateFindMany = prisma.contractTemplate.findMany as unknown as ReturnType<
  typeof vi.fn
>;
const templateCreate = prisma.contractTemplate.create as unknown as ReturnType<
  typeof vi.fn
>;

const templateUpdate = vi.fn();
Object.assign(prisma.contractTemplate, {
  update: templateUpdate,
  delete: vi.fn().mockResolvedValue({}),
});

const CLAUSULA =
  "8.1. Para garantir as obrigações assumidas, o FIADOR assume responsabilidade solidária com a PARTE LOCATÁRIA.";

function docxFile(): File {
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(60).fill(0x41)]);
  return new File([bytes], "locacao.docx");
}

function req(fields: Record<string, string> = {}): Request {
  const fd = new FormData();
  fd.append("file", docxFile());
  fd.append("modalidade", "locacao");
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return new Request("http://localhost/api/templates/from-docx", {
    method: "POST",
    body: fd,
  });
}

/** Última escrita de `handlebarsSource` (a declaração dos slots). */
function declaredSource(): string | undefined {
  const calls = templateUpdate.mock.calls.filter(
    (c) => typeof c[0]?.data?.handlebarsSource === "string"
  );
  return calls.at(-1)?.[0].data.handlebarsSource as string | undefined;
}

/** Último `draftReport` gravado. */
function draftReport(): Record<string, unknown> | undefined {
  const calls = templateUpdate.mock.calls.filter((c) => c[0]?.data?.draftReport);
  return calls.at(-1)?.[0].data.draftReport as Record<string, unknown> | undefined;
}

describe("POST /api/templates/from-docx — declaração de slot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "u1" } });
    getUserOrgMock.mockResolvedValue({ id: "org1" });
    membershipFindFirst.mockResolvedValue({ role: "owner" });
    templateFindFirst.mockResolvedValue(null);
    templateFindMany.mockResolvedValue([]);
    templateCreate.mockResolvedValue({ id: "tpl1", name: "Modelo" });
    templateUpdate.mockResolvedValue({});
    uploadFileAsGoogleDocMock.mockResolvedValue({
      docId: "doc1",
      webViewLink: "http://doc",
      embedLink: "http://embed",
    });
    insertPlaceholdersMock.mockResolvedValue({ inserted: [], missingRequired: [] });
    applySlotMock.mockResolvedValue({
      slot: "garantia",
      applied: true,
      token: "{{slot_garantia}}",
      removed: 0,
      issues: [],
    });
  });

  it("a row NASCE sem declaração de slot (só o cabeçalho)", async () => {
    await POST(req({ slotBlocks: JSON.stringify({ garantia: [CLAUSULA] }) }) as never);
    const created = templateCreate.mock.calls[0][0].data.handlebarsSource as string;
    expect(created).toBe("<!-- engine=google_docs: a fonte é o Google Doc -->");
    expect(created).not.toContain("slot_garantia");
  });

  it("slot ABERTO com sucesso → declaração escrita no handlebarsSource", async () => {
    const res = await POST(
      req({ slotBlocks: JSON.stringify({ garantia: [CLAUSULA] }) }) as never
    );
    expect(res.status).toBe(200);
    expect(applySlotMock).toHaveBeenCalledWith({
      docId: "doc1",
      slot: "garantia",
      paragraphs: [CLAUSULA],
    });
    expect(declaredSource()).toContain("<!-- slots: {{slot_garantia}} -->");
    expect((await res.json()).slots[0].applied).toBe(true);
  });

  it("REGRESSÃO F1: slot NÃO aberto → NADA é declarado", async () => {
    applySlotMock.mockResolvedValue({
      slot: "garantia",
      applied: false,
      token: null,
      removed: 0,
      issues: [{ paragraph: CLAUSULA, reason: "ambiguous" }],
    });

    const res = await POST(
      req({ slotBlocks: JSON.stringify({ garantia: [CLAUSULA] }) }) as never
    );

    expect(res.status).toBe(200);
    expect(declaredSource()).toBeUndefined();
    const report = draftReport();
    expect(report?.slots).toEqual([
      expect.objectContaining({ applied: false, token: null }),
    ]);
  });

  it("o motivo da falha chega ao draftReport MESMO quando o pass de IA quebra", async () => {
    applySlotMock.mockResolvedValue({
      slot: "garantia",
      applied: false,
      token: null,
      removed: 0,
      issues: [{ paragraph: CLAUSULA, reason: "not-found" }],
    });
    insertPlaceholdersMock.mockRejectedValue(new Error("Anthropic 529"));

    const res = await POST(
      req({ slotBlocks: JSON.stringify({ garantia: [CLAUSULA] }) }) as never
    );

    expect(res.status).toBe(200);
    const slots = draftReport()?.slots as Array<Record<string, unknown>>;
    expect(slots?.[0]).toMatchObject({ applied: false });
    expect((slots?.[0].issues as unknown[])[0]).toMatchObject({ reason: "not-found" });
  });

  it("sem slotBlocks o fluxo antigo segue idêntico — nada de slot em lugar nenhum", async () => {
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect(applySlotMock).not.toHaveBeenCalled();
    expect(declaredSource()).toBeUndefined();
    expect(draftReport()).not.toHaveProperty("slots");
  });

  it("matchCriteria do pareamento objetivo é persistido no create", async () => {
    await POST(
      req({ matchCriteria: JSON.stringify({ garantia: "fiador", pessoa: "pj" }) }) as never
    );
    expect(templateCreate.mock.calls[0][0].data.matchCriteria).toEqual({
      garantia: "fiador",
      pessoa: "pj",
    });
  });

  it("400 para matchCriteria fora do enum do formulário", async () => {
    const res = await POST(req({ matchCriteria: JSON.stringify({ garantia: "xpto" }) }) as never);
    expect(res.status).toBe(400);
    expect(templateCreate).not.toHaveBeenCalled();
  });

  it("400 para JSON malformado nos campos novos", async () => {
    const res = await POST(req({ slotBlocks: "{nao-json" }) as never);
    expect(res.status).toBe(400);
  });

  it("aceita as modalidades de PROPOSTA (eram recusadas pelo diálogo antigo)", async () => {
    const fd = new FormData();
    fd.append("file", docxFile());
    fd.append("modalidade", "proposta_locacao_residencial");
    const res = await POST(
      new Request("http://localhost/api/templates/from-docx", {
        method: "POST",
        body: fd,
      }) as never
    );
    expect(res.status).toBe(200);
    expect(templateCreate.mock.calls[0][0].data.modalidade).toBe(
      "proposta_locacao_residencial"
    );
  });
});
