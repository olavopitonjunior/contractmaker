import { describe, it, expect } from "vitest";
import {
  esteiraForProposalKind,
  parseProposalAssignment,
  proposalPartiesSnapshot,
  readAttachmentExtracted,
} from "../attachment-assignment";

describe("parseProposalAssignment — kind válido para a esteira", () => {
  it("locação aceita locatario/fiador/conjuge_fiador/locador/imovel/outro; recusa comprador", () => {
    expect(parseProposalAssignment({ kind: "locatario", index: 1 }, "locacao")).toEqual({ kind: "locatario", index: 1 });
    expect(parseProposalAssignment({ kind: "fiador", index: 0 }, "locacao")).toEqual({ kind: "fiador", index: 0 });
    expect(parseProposalAssignment({ kind: "conjuge_fiador", index: 0 }, "locacao")?.kind).toBe("conjuge_fiador");
    expect(parseProposalAssignment({ kind: "outro", index: 0 }, "locacao")?.kind).toBe("outro");
    expect(parseProposalAssignment({ kind: "comprador", index: 0 }, "locacao")).toBeNull();
  });

  it("venda aceita vendedor/comprador/imovel; recusa locatario", () => {
    expect(parseProposalAssignment({ kind: "comprador", index: 0 }, "venda")?.kind).toBe("comprador");
    expect(parseProposalAssignment({ kind: "locatario", index: 0 }, "venda")).toBeNull();
  });

  it("lixo → null", () => {
    expect(parseProposalAssignment(null, "venda")).toBeNull();
    expect(parseProposalAssignment({ kind: "vendedor", index: -1 }, "venda")).toBeNull();
    expect(parseProposalAssignment({ kind: "vendedor", index: 999 }, "venda")).toBeNull();
    expect(parseProposalAssignment({ kind: "xpto", index: 0 }, "venda")).toBeNull();
  });

  it("esteira por kind da proposta", () => {
    expect(esteiraForProposalKind("locacao")).toBe("locacao");
    expect(esteiraForProposalKind("venda")).toBe("venda");
    expect(esteiraForProposalKind(null)).toBe("venda");
  });
});

describe("readAttachmentExtracted / proposalPartiesSnapshot", () => {
  it("lê tolerante e cai em outro:0 sem assignment", () => {
    expect(readAttachmentExtracted(null)).toEqual({
      fields: null,
      category: null,
      confidence: null,
      assignment: { kind: "outro", index: 0 },
      assignmentPersisted: false,
    });
    const v = readAttachmentExtracted({
      fields: { a: 1 },
      category: "rg",
      confidence: 0.9,
      assignment: { kind: "locatario", index: 2 },
      assignmentPersisted: true,
    });
    expect(v.assignment).toEqual({ kind: "locatario", index: 2 });
    expect(v.assignmentPersisted).toBe(true);
  });

  it("snapshot filtra lixo e projeta a garantia", () => {
    const s = proposalPartiesSnapshot({
      locatarios: [{ nome: "A" }, null, "x"],
      garantia: { tipo: "fiador", fiador: { nome: "F" }, caucao_meses: 0 },
    });
    expect(s.locatarios).toEqual([{ nome: "A" }]);
    expect(s.garantia).toEqual({ tipo: "fiador", fiador: { nome: "F" } });
    expect(s.vendedores).toEqual([]);
    expect(proposalPartiesSnapshot(null).garantia).toBeUndefined();
  });
});
