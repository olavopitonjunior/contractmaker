/**
 * Do cadastro ao texto: `loadOrgRecebimento` (colunas de `Organization`) →
 * `imobiliariaDadosPagamento` é a linha do call site da geração que resolve o
 * bloqueio dos modelos da Trio (a conta vai para o Doc, não para o dataJson).
 * Prisma mockado — sem Google, sem banco. Sem `mockReset` em beforeEach: no
 * vitest 4 ele fez um erro capturado pelo código sob teste virar falha.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn() },
  },
}));

import { prisma } from "@/lib/db/prisma";
import { loadOrgRecebimento } from "../org-recebimento";
import { imobiliariaDadosPagamento } from "@/lib/templates/imobiliaria";

const findUnique = prisma.organization.findUnique as unknown as ReturnType<typeof vi.fn>;

describe("loadOrgRecebimento → imobiliaria_dados_pagamento", () => {
  it("PIX cadastrado no Perfil vira a via de recebimento no Doc", async () => {
    findUnique.mockResolvedValue({
      pixAddressKey: "12.345.678/0001-90",
      pixKeyType: "CNPJ",
      bankName: null,
      bankBranch: null,
      bankAccount: null,
      bankAccountType: null,
      bankHolderName: "Imobiliária Exemplo Ltda",
      bankHolderDoc: null,
    });
    const recebimento = await loadOrgRecebimento("org-1");
    expect(imobiliariaDadosPagamento(recebimento)).toBe(
      "na chave PIX (CNPJ): 12.345.678/0001-90, de titularidade de Imobiliária Exemplo Ltda"
    );
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "org-1" }, select: expect.objectContaining({ pixAddressKey: true, bankAccount: true }) })
    );
  });

  it("conta completa sem PIX sai como conta; incompleta sai vazia", async () => {
    findUnique.mockResolvedValue({
      pixAddressKey: null,
      pixKeyType: null,
      bankName: "Itaú",
      bankBranch: "1234",
      bankAccount: "56789-0",
      bankAccountType: "corrente",
      bankHolderName: null,
      bankHolderDoc: null,
    });
    expect(imobiliariaDadosPagamento(await loadOrgRecebimento("org-1"))).toBe(
      "no Banco Itaú, Agência 1234, Conta corrente nº 56789-0"
    );
    findUnique.mockResolvedValue({ bankName: "Itaú", bankBranch: "1234", bankAccount: "56789-0", bankAccountType: null });
    expect(imobiliariaDadosPagamento(await loadOrgRecebimento("org-1"))).toBe("");
  });

  it("org inexistente ou cadastro vazio → null → chave vazia; a geração não tropeça", async () => {
    findUnique.mockResolvedValue(null);
    expect(await loadOrgRecebimento("org-x")).toBeNull();
    expect(imobiliariaDadosPagamento(null)).toBe("");
    findUnique.mockResolvedValue({ pixAddressKey: null, pixKeyType: null, bankName: null, bankBranch: null, bankAccount: null, bankAccountType: null, bankHolderName: null, bankHolderDoc: null });
    expect(imobiliariaDadosPagamento(await loadOrgRecebimento("org-1"))).toBe("");
  });

  it("banco fora do ar → nunca lança, devolve null", async () => {
    findUnique.mockImplementation(() => {
      throw new Error("connection refused");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(loadOrgRecebimento("org-1")).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("recebimento da imobiliária"), expect.any(Error));
    warn.mockRestore();
  });
});
