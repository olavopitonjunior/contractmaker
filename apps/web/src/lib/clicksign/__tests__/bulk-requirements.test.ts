import { describe, it, expect, beforeEach, vi } from "vitest";

// Camada HTTP mockada — o teste valida o SHAPE do payload atomic operations
// que o wrapper monta (é o contrato com a ClickSign pra envelope `running`).
vi.mock("../client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client")>();
  return { ...actual, clicksignRequest: vi.fn().mockResolvedValue({}) };
});

import { bulkRequirements } from "../envelopes";
import { clicksignRequest } from "../client";

const request = clicksignRequest as unknown as ReturnType<typeof vi.fn>;

describe("bulkRequirements", () => {
  beforeEach(() => {
    request.mockClear();
  });

  it("monta atomic:operations com add (auth + agree) e remove", async () => {
    await bulkRequirements("env-1", [
      {
        op: "add",
        action: "provide_evidence",
        auth: "email",
        documentClicksignId: "doc-1",
        signerClicksignId: "sig-1",
      },
      {
        op: "add",
        action: "agree",
        role: "witness",
        documentClicksignId: "doc-1",
        signerClicksignId: "sig-1",
      },
      { op: "remove", requirementId: "req-old" },
    ]);

    expect(request).toHaveBeenCalledTimes(1);
    const call = request.mock.calls[0][0];
    expect(call.method).toBe("POST");
    expect(call.path).toBe("/api/v3/envelopes/env-1/bulk_requirements");
    expect(call.body["atomic:operations"]).toEqual([
      {
        op: "add",
        data: {
          type: "requirements",
          attributes: { action: "provide_evidence", auth: "email" },
          relationships: {
            document: { data: { type: "documents", id: "doc-1" } },
            signer: { data: { type: "signers", id: "sig-1" } },
          },
        },
      },
      {
        op: "add",
        data: {
          type: "requirements",
          attributes: { action: "agree", role: "witness" },
          relationships: {
            document: { data: { type: "documents", id: "doc-1" } },
            signer: { data: { type: "signers", id: "sig-1" } },
          },
        },
      },
      { op: "remove", ref: { type: "requirements", id: "req-old" } },
    ]);
  });

  it("propaga creds pro clicksignRequest", async () => {
    const creds = { apiToken: "t", baseUrl: "https://x" };
    await bulkRequirements(
      "env-2",
      [{ op: "remove", requirementId: "r1" }],
      creds as never
    );
    expect(request.mock.calls[0][0].creds).toBe(creds);
  });
});
