import { describe, it, expect, beforeEach, vi } from "vitest";

// Valida o mecanismo de cancelamento v3 (por DOCUMENTO — o PATCH do envelope
// com status:"canceled" passou a ser recusado; confirmado ao vivo 2026-07-24).
vi.mock("../client", () => {
  class ClicksignError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly body?: unknown
    ) {
      super(message);
      this.name = "ClicksignError";
    }
  }
  return { clicksignRequest: vi.fn(), ClicksignError };
});

import { cancelEnvelope } from "../envelopes";
import { clicksignRequest, ClicksignError } from "../client";

const requestMock = clicksignRequest as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cancelEnvelope (v3: cancela por documento)", () => {
  it("lista documentos e PATCHa cada um com status canceled — nunca PATCHa o envelope", async () => {
    requestMock
      .mockResolvedValueOnce({
        data: [
          { id: "doc-1", type: "documents", attributes: { status: "running" } },
          { id: "doc-2", type: "documents", attributes: { status: "running" } },
        ],
      })
      .mockResolvedValue({});

    await cancelEnvelope("env-1", { token: "t", baseUrl: "https://x" });

    expect(requestMock).toHaveBeenCalledTimes(3);
    expect(requestMock.mock.calls[0][0]).toMatchObject({
      method: "GET",
      path: "/api/v3/envelopes/env-1/documents",
    });
    for (const [i, docId] of [...["doc-1", "doc-2"].entries()]) {
      expect(requestMock.mock.calls[i + 1][0]).toMatchObject({
        method: "PATCH",
        path: `/api/v3/envelopes/env-1/documents/${docId}`,
        body: {
          data: {
            id: docId,
            type: "documents",
            attributes: { status: "canceled" },
          },
        },
      });
    }
    const envelopePatch = requestMock.mock.calls.find(
      (c) => c[0].method === "PATCH" && c[0].path === "/api/v3/envelopes/env-1"
    );
    expect(envelopePatch).toBeUndefined();
  });

  it("pula documentos já cancelados (idempotência)", async () => {
    requestMock
      .mockResolvedValueOnce({
        data: [
          { id: "doc-1", attributes: { status: "canceled" } },
          { id: "doc-2", attributes: { status: "running" } },
        ],
      })
      .mockResolvedValue({});

    await cancelEnvelope("env-1");

    const patches = requestMock.mock.calls.filter((c) => c[0].method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0][0].path).toBe("/api/v3/envelopes/env-1/documents/doc-2");
  });

  it("envelope sem documentos → ClicksignError 422 (não silencia)", async () => {
    requestMock.mockResolvedValueOnce({ data: [] });

    await expect(cancelEnvelope("env-1")).rejects.toMatchObject({
      name: "ClicksignError",
      status: 422,
    });
  });

  it("propaga falha do PATCH de documento", async () => {
    requestMock
      .mockResolvedValueOnce({ data: [{ id: "doc-1", attributes: {} }] })
      .mockRejectedValueOnce(new ClicksignError("recusado", 400));

    await expect(cancelEnvelope("env-1")).rejects.toBeInstanceOf(ClicksignError);
  });
});
