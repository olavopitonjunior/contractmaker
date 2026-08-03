import { describe, it, expect, vi } from "vitest";
import { archiveAttachment } from "../archive";

/**
 * `archiveAttachment` é o ponto ÚNICO de exclusão de anexo. Ao ganhar o origin
 * "proposal", o risco novo é apagar da tabela ERRADA — arquivar a proposta e
 * deletar o anexo do negócio deixaria o negócio sem documento e a proposta
 * intacta. Estes testes travam o roteamento por origin.
 */
function makeDb() {
  return {
    deletedAttachment: { create: vi.fn().mockResolvedValue({ id: "arch-1" }) },
    dealAttachment: { delete: vi.fn().mockResolvedValue({}) },
    formAttachment: { delete: vi.fn().mockResolvedValue({}) },
    proposalAttachment: { delete: vi.fn().mockResolvedValue({}) },
  };
}

const ROW = {
  id: "att-1",
  filename: "Registro do Aceite (ClickSign).pdf",
  url: "https://blob/registro.pdf",
  category: "aceite_registro_clicksign",
  proposalId: "p1",
  source: "manual",
};

describe("archiveAttachment — origin proposal", () => {
  it("arquiva e apaga da tabela de PROPOSTA (não da de negócio)", async () => {
    const db = makeDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const id = await archiveAttachment(db as any, {
      row: ROW,
      origin: "proposal",
      via: "ui_proposal",
      orgId: "org1",
      userId: "u1",
    });

    expect(id).toBe("arch-1");
    expect(db.proposalAttachment.delete).toHaveBeenCalledWith({ where: { id: "att-1" } });
    expect(db.dealAttachment.delete).not.toHaveBeenCalled();
    expect(db.formAttachment.delete).not.toHaveBeenCalled();
  });

  it("grava proposalId na linha arquivada (dealId/formId ficam null)", async () => {
    const db = makeDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await archiveAttachment(db as any, {
      row: ROW,
      origin: "proposal",
      via: "ui_proposal",
      orgId: "org1",
      userId: "u1",
    });

    const data = db.deletedAttachment.create.mock.calls[0][0].data;
    expect(data.origin).toBe("proposal");
    expect(data.proposalId).toBe("p1");
    expect(data.dealId).toBeNull();
    expect(data.formId).toBeNull();
    expect(data.url).toBe(ROW.url);
    // O payload guarda a linha inteira — é o que permite restaurar campos que
    // a tabela de arquivo não tem coluna própria pra guardar.
    expect(data.payload.source).toBe("manual");
  });

  it("origin deal continua apagando do negócio (sem regressão)", async () => {
    const db = makeDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await archiveAttachment(db as any, {
      row: { id: "d-1", filename: "x.pdf", url: "https://blob/x.pdf", dealId: "deal1" },
      origin: "deal",
      via: "ui_deal",
      orgId: "org1",
    });
    expect(db.dealAttachment.delete).toHaveBeenCalledOnce();
    expect(db.proposalAttachment.delete).not.toHaveBeenCalled();
    expect(db.deletedAttachment.create.mock.calls[0][0].data.proposalId).toBeNull();
  });

  it("origin form continua apagando do formulário (sem regressão)", async () => {
    const db = makeDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await archiveAttachment(db as any, {
      row: { id: "f-1", filename: "y.pdf", url: "https://blob/y.pdf", formId: "form1" },
      origin: "form",
      via: "ui_form",
      orgId: "org1",
    });
    expect(db.formAttachment.delete).toHaveBeenCalledOnce();
    expect(db.proposalAttachment.delete).not.toHaveBeenCalled();
  });
});
