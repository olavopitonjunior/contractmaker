import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";

// REST ClickSign mockado — o teste valida a ORQUESTRAÇÃO do addSignerToEnvelope
// (draft usa POST /requirements simples; running usa bulk + notificação).
vi.mock("../envelopes", () => ({
  addRequirement: vi.fn(),
  addSigner: vi.fn(),
  bulkRequirements: vi.fn(),
  listEnvelopeRequirements: vi.fn().mockResolvedValue({ data: [] }),
  notifySigner: vi.fn().mockResolvedValue({}),
  removeRequirement: vi.fn(),
  removeSigner: vi.fn().mockResolvedValue(undefined),
  updateSigner: vi.fn(),
}));
vi.mock("../account", () => ({
  resolveClickSignCreds: vi
    .fn()
    .mockResolvedValue({ apiToken: "t", baseUrl: "https://x" }),
  getSignatureSettings: vi.fn().mockResolvedValue({ allowedAuthMethods: [] }),
}));

import { addSignerToEnvelope, updateSignerAction } from "../signer-actions";
import { ClicksignError } from "../client";
import {
  addRequirement,
  addSigner,
  bulkRequirements,
  listEnvelopeRequirements,
  notifySigner,
  removeSigner,
} from "../envelopes";

const addSignerMock = addSigner as unknown as ReturnType<typeof vi.fn>;
const addReqMock = addRequirement as unknown as ReturnType<typeof vi.fn>;
const bulkMock = bulkRequirements as unknown as ReturnType<typeof vi.fn>;
const listReqMock = listEnvelopeRequirements as unknown as ReturnType<typeof vi.fn>;
const notifyMock = notifySigner as unknown as ReturnType<typeof vi.fn>;
const removeSignerMock = removeSigner as unknown as ReturnType<typeof vi.fn>;

type MockFn = ReturnType<typeof vi.fn>;
const signerDb = prisma.envelopeSigner as unknown as Record<string, MockFn>;

function makeEnvelope(over: Record<string, unknown> = {}) {
  return {
    id: "env-db-1",
    orgId: "org-1",
    status: "running",
    clicksignId: "cs-env",
    documentClicksignId: "cs-doc",
    authMethod: "email",
    ...over,
  } as never;
}

const addData = {
  name: "Nova Testemunha",
  email: "nova@example.com",
  sourceKind: "testemunha",
  sourceIndex: 0,
  role: "witness" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  signerDb.create = vi.fn().mockResolvedValue({ id: "local-1" });
  signerDb.update = vi.fn().mockResolvedValue({});
  signerDb.delete = vi.fn().mockResolvedValue({});
  signerDb.findUnique = vi.fn().mockResolvedValue({ id: "local-1", status: "notified" });
  addSignerMock.mockResolvedValue({ data: { id: "cs-sig" } });
  listReqMock.mockResolvedValue({ data: [] });
  notifyMock.mockResolvedValue({});
});

describe("addSignerToEnvelope em envelope running", () => {
  it("usa bulk_requirements (não POST /requirements) e notifica na hora", async () => {
    bulkMock.mockResolvedValue({
      "atomic:results": [
        { data: { type: "requirements", id: "r-auth" } },
        { data: { type: "requirements", id: "r-agree" } },
      ],
    });

    const result = await addSignerToEnvelope(makeEnvelope(), addData);

    expect(result.ok).toBe(true);
    expect(addReqMock).not.toHaveBeenCalled();
    expect(bulkMock).toHaveBeenCalledTimes(1);
    const ops = bulkMock.mock.calls[0][1];
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({ op: "add", action: "provide_evidence", auth: "email" });
    expect(ops[1]).toMatchObject({ op: "add", action: "agree", role: "witness" });
    expect(notifyMock).toHaveBeenCalledWith("cs-env", "cs-sig", expect.anything());
    expect(signerDb.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clicksignId: "cs-sig",
          requirementIds: ["r-auth", "r-agree"],
          status: "notified",
          notifiedAt: expect.any(Date),
        }),
      })
    );
  });

  it("sem atomic:results, resolve os ids novos por diff antes/depois", async () => {
    listReqMock
      .mockResolvedValueOnce({ data: [{ id: "r-velho" }] })
      .mockResolvedValueOnce({
        data: [{ id: "r-velho" }, { id: "r-novo-1" }, { id: "r-novo-2" }],
      });
    bulkMock.mockResolvedValue({});

    const result = await addSignerToEnvelope(makeEnvelope(), addData);

    expect(result.ok).toBe(true);
    expect(listReqMock).toHaveBeenCalledTimes(2);
    expect(signerDb.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requirementIds: ["r-novo-1", "r-novo-2"],
        }),
      })
    );
  });

  it("rollback completo quando o bulk falha: remove signer remoto + row local", async () => {
    bulkMock.mockRejectedValue(new ClicksignError("recusado", 400));

    const result = await addSignerToEnvelope(makeEnvelope(), addData);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.error).toContain("cancele o envelope");
    }
    expect(removeSignerMock).toHaveBeenCalledWith("cs-env", "cs-sig", expect.anything());
    expect(signerDb.delete).toHaveBeenCalledWith({ where: { id: "local-1" } });
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("falha só na notificação NÃO desfaz: signer fica pending pro Reenviar", async () => {
    bulkMock.mockResolvedValue({
      "atomic:results": [
        { data: { type: "requirements", id: "r1" } },
        { data: { type: "requirements", id: "r2" } },
      ],
    });
    notifyMock.mockRejectedValue(new ClicksignError("smtp", 500));

    const result = await addSignerToEnvelope(makeEnvelope(), addData);

    expect(result.ok).toBe(true);
    expect(removeSignerMock).not.toHaveBeenCalled();
    expect(signerDb.delete).not.toHaveBeenCalled();
    expect(signerDb.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "pending", notifiedAt: null }),
      })
    );
  });
});

describe("addSignerToEnvelope — bulk aplicado sem confirmação de IDs", () => {
  it("desfaz a inclusão (remove remoto + local) e retorna 502 acionável", async () => {
    // atomic:results ausente E diff sempre vazio (before == after) → não dá
    // pra confirmar os IDs; a inclusão é desfeita pra não ficar signer sem
    // requirement rastreado.
    bulkMock.mockResolvedValue({});
    listReqMock.mockResolvedValue({ data: [{ id: "r-preexistente" }] });

    const result = await addSignerToEnvelope(makeEnvelope(), addData);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.error).toContain("não foi possível confirmar");
    }
    expect(removeSignerMock).toHaveBeenCalledWith("cs-env", "cs-sig", expect.anything());
    expect(signerDb.delete).toHaveBeenCalledWith({ where: { id: "local-1" } });
    expect(notifyMock).not.toHaveBeenCalled();
  }, 15000);
});

describe("updateSignerAction (trocar papel) em envelope running", () => {
  function makeSigner(over: Record<string, unknown> = {}) {
    return {
      id: "sgn-db-1",
      clicksignId: "cs-sig-1",
      status: "notified",
      role: "sign",
      authMethod: "email",
      requirementIds: ["r-old-1", "r-old-2"],
      name: "Parte",
      email: "parte@example.com",
      documentation: null,
      phone: null,
      envelope: {
        id: "env-db-1",
        orgId: "org-1",
        status: "running",
        clicksignId: "cs-env",
        documentClicksignId: "cs-doc",
      },
      ...over,
    } as never;
  }

  it("recria requirements via bulk atômico: 2 adds + removes dos antigos", async () => {
    bulkMock.mockResolvedValue({
      "atomic:results": [
        { data: { type: "requirements", id: "r-new-1" } },
        { data: { type: "requirements", id: "r-new-2" } },
      ],
    });

    const result = await updateSignerAction(makeSigner(), { role: "witness" });

    expect(result.ok).toBe(true);
    expect(addReqMock).not.toHaveBeenCalled();
    expect(bulkMock).toHaveBeenCalledTimes(1);
    const ops = bulkMock.mock.calls[0][1];
    expect(ops).toEqual([
      expect.objectContaining({ op: "add", action: "provide_evidence", auth: "email" }),
      expect.objectContaining({ op: "add", action: "agree", role: "witness" }),
      { op: "remove", requirementId: "r-old-1" },
      { op: "remove", requirementId: "r-old-2" },
    ]);
    expect(signerDb.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "witness",
          requirementIds: ["r-new-1", "r-new-2"],
        }),
      })
    );
  });

  it("bulk aplicado sem confirmação de IDs: persiste papel com requirementIds vazio", async () => {
    // O remoto JÁ mudou — não persistir o papel deixaria o DB mentindo e um
    // retry miraria IDs mortos. requirementIds vazio sinaliza "desconhecidos".
    bulkMock.mockResolvedValue({});
    listReqMock.mockResolvedValue({ data: [{ id: "r-old-1" }, { id: "r-old-2" }] });

    const result = await updateSignerAction(makeSigner(), { role: "witness" });

    expect(result.ok).toBe(true);
    expect(signerDb.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: "witness", requirementIds: [] }),
      })
    );
  }, 15000);

  it("ClicksignError no bulk (nada aplicou): 502 sem persistir papel", async () => {
    bulkMock.mockRejectedValue(new ClicksignError("recusado", 400));

    const result = await updateSignerAction(makeSigner(), { role: "witness" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(502);
    expect(signerDb.update).not.toHaveBeenCalled();
  });
});

describe("addSignerToEnvelope fora de running", () => {
  it("draft mantém o caminho antigo: 2x POST /requirements, sem bulk nem notify", async () => {
    addReqMock
      .mockResolvedValueOnce({ data: { id: "r-auth" } })
      .mockResolvedValueOnce({ data: { id: "r-agree" } });

    const result = await addSignerToEnvelope(
      makeEnvelope({ status: "draft" }),
      addData
    );

    expect(result.ok).toBe(true);
    expect(addReqMock).toHaveBeenCalledTimes(2);
    expect(bulkMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
    expect(signerDb.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "pending", notifiedAt: null }),
      })
    );
  });

  it("envelope encerrado/cancelado segue 409", async () => {
    for (const status of ["closed", "canceled", "failed"]) {
      const result = await addSignerToEnvelope(makeEnvelope({ status }), addData);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(409);
    }
    expect(addSignerMock).not.toHaveBeenCalled();
  });
});
