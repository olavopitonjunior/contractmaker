import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const uploadMock = vi.fn();
vi.mock("@vercel/blob/client", () => ({
  upload: (...args: unknown[]) => uploadMock(...args),
}));

import {
  rejectFileReason,
  uploadFormAttachment,
  ACCEPTED_MIMES,
  MAX_BYTES,
} from "@/lib/forms/attachment-upload";

/**
 * Este módulo saiu de dentro do DocumentosStep para ser reusado pelo bloco da
 * matrícula (etapa Imóvel). As duas telas TÊM que aceitar/recusar os mesmos
 * arquivos: divergir aqui produz o pior tipo de bug — o arquivo passa na
 * validação do cliente e morre no servidor com erro opaco.
 */
describe("rejectFileReason", () => {
  const file = (name: string, type: string, size: number) => {
    const f = new File(["x"], name, { type });
    Object.defineProperty(f, "size", { value: size });
    return f;
  };

  it("aceita todos os tipos anunciados no input", () => {
    for (const mime of ACCEPTED_MIMES) {
      expect(rejectFileReason(file("doc", mime, 1024))).toBeNull();
    }
  });

  it("recusa tipo fora da lista nomeando o arquivo", () => {
    const reason = rejectFileReason(file("planilha.xlsx", "application/vnd.ms-excel", 10));
    expect(reason).toContain("planilha.xlsx");
    expect(reason).toContain("formato");
  });

  it("recusa acima de 20MB e aceita exatamente no limite", () => {
    expect(rejectFileReason(file("m.pdf", "application/pdf", MAX_BYTES))).toBeNull();
    expect(rejectFileReason(file("m.pdf", "application/pdf", MAX_BYTES + 1))).toContain(
      "20MB"
    );
  });
});

describe("uploadFormAttachment", () => {
  const endpoint = "/api/forms/tok123/attachments";
  const pdf = () => new File(["%PDF"], "matricula.pdf", { type: "application/pdf" });

  beforeEach(() => {
    uploadMock.mockReset();
    uploadMock.mockResolvedValue({ url: "https://blob.example/abc.pdf" });
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sobe pro Blob pelo handshake do próprio formulário e finaliza", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ id: "att1", filename: "matricula.pdf", cached: false }),
    });

    const res = await uploadFormAttachment(endpoint, pdf());

    expect(uploadMock).toHaveBeenCalledWith(
      expect.stringContaining("form-attachments/"),
      expect.any(File),
      expect.objectContaining({ handleUploadUrl: `${endpoint}/blob-upload` })
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${endpoint}/finalize`,
      expect.objectContaining({ method: "POST" })
    );
    expect(res.id).toBe("att1");
  });

  it("o pathname do Blob NÃO carrega o token do formulário", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ id: "att1" }),
    });
    await uploadFormAttachment(endpoint, pdf());
    // A URL do Blob é pública e permanente; o token é segredo de acesso ao
    // formulário inteiro e não pode vazar nela.
    expect(uploadMock.mock.calls[0][0]).not.toContain("tok123");
  });

  it("propaga a mensagem de erro do finalize", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Conteúdo vazio" }),
    });
    await expect(uploadFormAttachment(endpoint, pdf())).rejects.toThrow("Conteúdo vazio");
  });

  it("erro sem corpo JSON ainda vira mensagem legível", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => {
        throw new Error("not json");
      },
    });
    await expect(uploadFormAttachment(endpoint, pdf())).rejects.toThrow("Falha no upload");
  });
});
