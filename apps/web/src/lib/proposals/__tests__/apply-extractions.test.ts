import { describe, it, expect } from "vitest";
import { applyProposalExtractions } from "../apply-extractions";

const ready = (over: Record<string, unknown>) => ({
  id: "att-1",
  status: "ready",
  createdAt: "2026-09-04T10:00:00.000Z",
  extractedData: {
    category: "rg",
    fields: { nome_completo: "Maria Souza", cpf_numero: "529.982.247-25", data_nascimento: "10/05/1990" },
    assignment: { kind: "locatario", index: 0 },
    assignmentPersisted: true,
  },
  ...over,
});

describe("applyProposalExtractions — OCR da proposta entra no dado do negócio na conversão", () => {
  it("locação: preenche o locatário a partir do documento com atribuição humana, sem sobrescrever", () => {
    const data = { locatarios: [{ tipo_pessoa: "fisica", nome: "Maria Souza", cpf: "" }] };
    const r = applyProposalExtractions(data, [ready({})], "locacao");
    expect(r.filled).toBeGreaterThan(0);
    expect(r.applied).toEqual(["att-1"]);
    const loc = (r.merged.locatarios as Array<Record<string, unknown>>)[0];
    expect(loc.cpf).toBe("52998224725");
    expect(loc.nome).toBe("Maria Souza");
    // input intacto
    expect((data.locatarios[0] as Record<string, unknown>).cpf).toBe("");
  });

  it("só atribuição HUMANA escreve; sugestão do OCR é ignorada", () => {
    const data = { locatarios: [{ tipo_pessoa: "fisica", nome: "Maria Souza" }] };
    const r = applyProposalExtractions(
      data,
      [ready({ extractedData: { ...ready({}).extractedData, assignmentPersisted: false } })],
      "locacao"
    );
    expect(r.filled).toBe(0);
    expect(r.applied).toEqual([]);
  });

  it("anexo não pronto, sem fields ou em 'outro' não entra", () => {
    const data = { locatarios: [{ tipo_pessoa: "fisica", nome: "Maria" }] };
    const r = applyProposalExtractions(
      data,
      [
        ready({ status: "awaiting_user" }),
        ready({ id: "b", extractedData: { assignment: { kind: "locatario", index: 0 }, assignmentPersisted: true } }),
        ready({ id: "c", extractedData: { ...ready({}).extractedData, assignment: { kind: "outro", index: 0 } } }),
      ],
      "locacao"
    );
    expect(r.filled).toBe(0);
  });

  it("locação: documento no FIADOR define a garantia (flip) e preenche garantia.fiador", () => {
    const data = { locatarios: [{ nome: "Maria" }], garantia: { tipo: "caucao", caucao_meses: 3 } };
    const r = applyProposalExtractions(
      data,
      [ready({ extractedData: { ...ready({}).extractedData, assignment: { kind: "fiador", index: 0 } } })],
      "locacao"
    );
    const g = r.merged.garantia as Record<string, unknown>;
    expect(g.tipo).toBe("fiador");
    expect((g.fiador as Record<string, unknown>).cpf).toBe("52998224725");
  });

  it("venda: usa o mapper de venda (compradores.N)", () => {
    const data = { compradores: [{ tipo_pessoa: "fisica", nome: "João" }] };
    const r = applyProposalExtractions(
      data,
      [ready({ extractedData: { ...ready({}).extractedData, assignment: { kind: "comprador", index: 0 } } })],
      "venda"
    );
    expect(((r.merged.compradores as Array<Record<string, unknown>>)[0]).cpf).toBe("52998224725");
  });

  it("kind desconhecido devolve o dado intacto", () => {
    const data = { x: 1 };
    expect(applyProposalExtractions(data, [ready({})], "outra")).toEqual({ merged: data, filled: 0, applied: [] });
  });
});
