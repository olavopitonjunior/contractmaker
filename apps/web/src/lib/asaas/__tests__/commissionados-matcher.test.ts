import { describe, it, expect } from "vitest";
import {
  matchComissionadosToSplitRecipients,
  type ComissionadoLike,
} from "../commissionados-matcher";
import type { SplitRecipient } from "@prisma/client";

function recipient(overrides: Partial<SplitRecipient>): SplitRecipient {
  return {
    id: "rec-1",
    orgId: "org-1",
    label: "Test",
    recipientType: "pix_external",
    walletId: null,
    pixAddressKey: "test@example.com",
    pixKeyType: "EMAIL",
    ownerName: "Test Owner",
    ownerCpfCnpj: "12345678901",
    cpfCnpj: "12345678901",
    description: null,
    email: null,
    pendingFields: [],
    completionToken: null,
    completionTokenExp: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as SplitRecipient & { pendingFields: string[] };
}

describe("matchComissionadosToSplitRecipients", () => {
  it("matches por CPF normalizado (com ou sem máscara)", () => {
    const recipients = [
      recipient({ id: "r-cpf", cpfCnpj: "12345678901", label: "Sandra" }),
    ];
    const comissionados: ComissionadoLike[] = [
      { nome: "Sandra Lie Yamamoto", cpf: "123.456.789-01", percentual: 100 },
    ];
    const result = matchComissionadosToSplitRecipients(comissionados, recipients);
    expect(result).toHaveLength(1);
    expect(result[0].suggestion).toBe("matched");
    expect(result[0].matchedBy).toBe("cpf_cnpj");
    expect(result[0].matchedRecipient?.id).toBe("r-cpf");
  });

  it("matches por nome quando CPF ausente", () => {
    const recipients = [
      recipient({
        id: "r-name",
        cpfCnpj: null,
        ownerCpfCnpj: null,
        label: "João Silva",
      }),
    ];
    const comissionados: ComissionadoLike[] = [
      { nome: "JOÃO SILVA", percentual: 50 }, // case + whitespace OK
    ];
    const result = matchComissionadosToSplitRecipients(comissionados, recipients);
    expect(result[0].suggestion).toBe("matched");
    expect(result[0].matchedBy).toBe("name");
  });

  it("normaliza diacríticos no nome (acentos)", () => {
    const recipients = [
      recipient({
        id: "r-acc",
        cpfCnpj: null,
        ownerCpfCnpj: null,
        label: "joao silva",
      }),
    ];
    const comissionados: ComissionadoLike[] = [
      { nome: "João Silva", percentual: 30 },
    ];
    const result = matchComissionadosToSplitRecipients(comissionados, recipients);
    expect(result[0].suggestion).toBe("matched");
    expect(result[0].matchedBy).toBe("name");
  });

  it("retorna 'create' quando há CPF mas sem match", () => {
    const recipients: SplitRecipient[] = [];
    const comissionados: ComissionadoLike[] = [
      { nome: "Maria Santos", cpf: "98765432100", percentual: 100 },
    ];
    const result = matchComissionadosToSplitRecipients(comissionados, recipients);
    expect(result[0].suggestion).toBe("create");
    expect(result[0].matchedRecipient).toBeNull();
  });

  it("retorna 'manual' quando não há CPF nem nome utilizável", () => {
    const recipients: SplitRecipient[] = [];
    const comissionados: ComissionadoLike[] = [
      { percentual: 10 }, // sem nome, sem CPF
    ];
    const result = matchComissionadosToSplitRecipients(comissionados, recipients);
    expect(result[0].suggestion).toBe("manual");
  });

  it("ignora recipients inativos", () => {
    const recipients = [
      recipient({ id: "r-inact", cpfCnpj: "11122233344", active: false }),
    ];
    const comissionados: ComissionadoLike[] = [
      { nome: "X", cpf: "11122233344", percentual: 100 },
    ];
    const result = matchComissionadosToSplitRecipients(comissionados, recipients);
    expect(result[0].suggestion).toBe("create"); // recipient inativo não conta
  });

  it("preserva 'source' do comissionado no resultado (passa-thru)", () => {
    const recipients: SplitRecipient[] = [];
    const comissionados: ComissionadoLike[] = [
      {
        nome: "Sandra",
        cpf: "12345678901",
        percentual: 100,
        source: "ccv.imobiliaria_principal",
      },
    ];
    const result = matchComissionadosToSplitRecipients(comissionados, recipients);
    expect(result[0].comissionado.source).toBe("ccv.imobiliaria_principal");
  });

  it("preferência: CPF antes de nome quando ambos batem com diferentes recipients", () => {
    const recipients = [
      recipient({
        id: "r-by-cpf",
        cpfCnpj: "12345678901",
        label: "Outra Pessoa",
      }),
      recipient({
        id: "r-by-name",
        cpfCnpj: "99999999999",
        label: "Sandra Lie Yamamoto",
      }),
    ];
    const comissionados: ComissionadoLike[] = [
      { nome: "Sandra Lie Yamamoto", cpf: "12345678901", percentual: 100 },
    ];
    const result = matchComissionadosToSplitRecipients(comissionados, recipients);
    expect(result[0].matchedBy).toBe("cpf_cnpj");
    expect(result[0].matchedRecipient?.id).toBe("r-by-cpf");
  });
});
