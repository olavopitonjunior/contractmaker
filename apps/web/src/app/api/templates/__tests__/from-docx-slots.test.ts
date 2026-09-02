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

/** Estado FINAL do Doc — é dele que a declaração é derivada (pós pass de IA). */
const getDocPlainTextMock = vi.fn();
vi.mock("@/lib/google/docs", () => ({
  getDocPlainText: (...args: unknown[]) => getDocPlainTextMock(...args),
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
    // Doc final com o token sobrevivendo ao pass de IA (caminho feliz).
    getDocPlainTextMock.mockResolvedValue(
      "CLÁUSULA OITAVA - DA GARANTIA\n{{slot_garantia}}\nCLÁUSULA NONA"
    );
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

  it("REGRESSÃO (Trio): pass de IA apaga o token → NADA é declarado e o slot é rebaixado", async () => {
    // applyClauseSlot reportou sucesso, mas a IA rodou depois e reescreveu o
    // token (era o que acontecia: {{slot_garantia}} virava {{clausula_garantia}}).
    // A declaração é derivada do doc FINAL, então não pode ser escrita.
    getDocPlainTextMock.mockResolvedValue(
      "CLÁUSULA OITAVA - DA GARANTIA\n{{clausula_garantia}}\nCLÁUSULA NONA"
    );

    const res = await POST(
      req({ slotBlocks: JSON.stringify({ garantia: [CLAUSULA] }) }) as never
    );

    expect(res.status).toBe(200);
    expect(declaredSource()).toBeUndefined();
    const slots = draftReport()?.slots as Array<Record<string, unknown>>;
    expect(slots[0]).toMatchObject({ applied: false, token: null });
    expect((slots[0].issues as Array<{ reason: string }>).at(-1)).toMatchObject({
      reason: "verify-failed",
    });
  });

  it("doc ilegível na conferência final → fail-closed, e o motivo NÃO afirma que o token sumiu", async () => {
    getDocPlainTextMock.mockRejectedValue(new Error("Rate Limit Exceeded"));

    const res = await POST(
      req({ slotBlocks: JSON.stringify({ garantia: [CLAUSULA] }) }) as never
    );

    expect(res.status).toBe(200);
    // Nada é declarado: não confirmamos, então não afirmamos.
    expect(declaredSource()).toBeUndefined();
    const slots = draftReport()?.slots as Array<Record<string, unknown>>;
    // A ativação segue travada (o operador precisa revalidar)…
    expect(slots[0].applied).toBe(false);
    // …mas o motivo é "não consegui conferir", não "conferi e não está lá".
    expect((slots[0].issues as Array<{ reason: string }>).at(-1)).toMatchObject({
      reason: "verify-unavailable",
    });
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

/**
 * Gate de PII do MODELO (lib/templates/pii-gate.ts): a ingestão mede o texto
 * FINAL do Doc — depois do passe de IA — e grava `draftReport.pii`. É esse
 * relatório que a trava da ativação lê. Caso real (Trio, 2026-09-01): 15/16
 * modelos saíram com CPF/PIX/conta de corretores literais e ninguém bloqueava.
 */
describe("POST /api/templates/from-docx — gate de PII do modelo", () => {
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
  });

  it("dado pessoal que sobrou literal → draftReport.pii.blocked = true", async () => {
    getDocPlainTextMock.mockResolvedValue(
      "{{locadores_qualificacao}}\nc) R$ 1.315,15 ao corretor, Agência 0001, Conta Corrente 682331986-6."
    );
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    const pii = draftReport()?.pii as Record<string, unknown>;
    expect(pii?.blocked).toBe(true);
    expect(pii?.kinds).toEqual(expect.arrayContaining(["bank_agency", "bank_account"]));
  });

  it("modelo SEM slot também é relido e medido (antes só se relia com slot aplicado)", async () => {
    getDocPlainTextMock.mockResolvedValue("{{locadores_qualificacao}}\nCPF nº 529.982.247-25");
    await POST(req() as never);
    expect(getDocPlainTextMock).toHaveBeenCalledWith("doc1");
    expect((draftReport()?.pii as Record<string, unknown>)?.kinds).toEqual(["cpf"]);
  });

  it("texto limpo → relatório gravado com blocked = false", async () => {
    getDocPlainTextMock.mockResolvedValue("{{locadores_qualificacao}} e {{aluguel_valor}}");
    await POST(req() as never);
    expect((draftReport()?.pii as Record<string, unknown>)?.blocked).toBe(false);
  });

  it("export VAZIO também é 'não medido' — nada de blocked:false sobre texto nenhum", async () => {
    getDocPlainTextMock.mockResolvedValue("");
    await POST(req() as never);
    expect(draftReport()?.pii).toBeUndefined();
  });

  it("Doc ilegível → sem relatório de PII (não afirma o que não mediu)", async () => {
    getDocPlainTextMock.mockRejectedValue(new Error("429"));
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect(draftReport()?.pii).toBeUndefined();
  });
});
