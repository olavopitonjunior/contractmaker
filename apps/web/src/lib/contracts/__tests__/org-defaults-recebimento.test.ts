/**
 * Do banco ao texto: `loadOrgLocacaoRecebimento` → `imobiliariaDadosPagamento`
 * é exatamente a linha do call site da geração que resolve o bloqueio dos
 * modelos da Trio (a conta da imobiliária vai para o Doc, não para o dataJson).
 * Prisma mockado — sem Google, sem banco.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    orgFormSettings: { findUnique: vi.fn() },
  },
}));

import { prisma } from "@/lib/db/prisma";
import { loadOrgLocacaoRecebimento } from "../org-defaults";
import { DEFAULT_LOCACAO_RECEBIMENTO } from "../default-config";
import { imobiliariaDadosPagamento } from "@/lib/templates/imobiliaria";

const findUnique = prisma.orgFormSettings.findUnique as unknown as ReturnType<typeof vi.fn>;

describe("loadOrgLocacaoRecebimento → imobiliaria_dados_pagamento", () => {
  it("padrão gravado pela imobiliária vira a via de recebimento no Doc", async () => {
    findUnique.mockResolvedValue({
      contractDefaultsJson: {
        locacao: { foro: "São Paulo/SP" },
        locacao_recebimento: {
          pix_chave: "64.524.938/0001-93",
          pix_tipo_chave: "CNPJ",
          banco: "",
          agencia: "",
          conta: "",
          tipo_conta: "",
          titular_nome: "Atrio Negócios Imobiliários Ltda",
          titular_doc: "",
        },
      },
    });
    const recebimento = await loadOrgLocacaoRecebimento("org-1");
    expect(imobiliariaDadosPagamento(recebimento)).toBe(
      "na chave PIX (CNPJ): 64.524.938/0001-93, de titularidade de Atrio Negócios Imobiliários Ltda"
    );
    expect(findUnique).toHaveBeenCalledWith({
      where: { orgId: "org-1" },
      select: { contractDefaultsJson: true },
    });
  });

  it("sem row → padrão vazio → chave vazia; a geração não tropeça", async () => {
    findUnique.mockResolvedValue(null);
    const recebimento = await loadOrgLocacaoRecebimento("org-1");
    expect(recebimento).toEqual(DEFAULT_LOCACAO_RECEBIMENTO);
    expect(imobiliariaDadosPagamento(recebimento)).toBe("");
  });

  it("banco fora do ar → nunca lança, cai no padrão vazio", async () => {
    // Lança ao ser chamado (dentro do `await` do loader) — o `catch` de lá é o
    // que está sendo provado.
    findUnique.mockImplementation(() => {
      throw new Error("connection refused");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(loadOrgLocacaoRecebimento("org-1")).resolves.toEqual(DEFAULT_LOCACAO_RECEBIMENTO);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("recebimento da org"),
      expect.any(Error)
    );
    warn.mockRestore();
  });
});
