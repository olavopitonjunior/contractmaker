import { describe, it, expect } from "vitest";
import {
  DELETABLE,
  buildBulkDeleteWhere,
  bulkDeleteSchema,
} from "../bulk-delete";

describe("buildBulkDeleteWhere", () => {
  it("scope=all_terminal alveja todos os estados deletáveis", () => {
    const res = buildBulkDeleteWhere({ scope: "all_terminal" });
    expect("where" in res).toBe(true);
    if ("where" in res) {
      expect(res.where).toEqual({ status: { in: [...DELETABLE] } });
    }
  });

  it("scope=replaced alveja só o histórico", () => {
    const res = buildBulkDeleteWhere({ scope: "replaced" });
    expect(res).toEqual({ where: { status: "replaced" } });
  });

  it("scope=status exige status válido e deletável", () => {
    expect(buildBulkDeleteWhere({ scope: "status" })).toEqual({
      error: "scope=status exige `status`",
    });
    // pending NÃO é deletável (job em andamento)
    expect(buildBulkDeleteWhere({ scope: "status", status: "pending" })).toEqual(
      { error: 'status "pending" nao e deletavel' }
    );
    expect(buildBulkDeleteWhere({ scope: "status", status: "failed" })).toEqual(
      { where: { status: "failed" } }
    );
  });

  it("scope=batch exige batchId e restringe a estados terminais", () => {
    expect(buildBulkDeleteWhere({ scope: "batch" })).toEqual({
      error: "scope=batch exige `batchId`",
    });
    const res = buildBulkDeleteWhere({ scope: "batch", batchId: "b-123" });
    expect(res).toEqual({
      where: { batchId: "b-123", status: { in: [...DELETABLE] } },
    });
  });

  it("nunca inclui pending/fetching no conjunto deletável", () => {
    expect(DELETABLE).not.toContain("pending");
    expect(DELETABLE).not.toContain("fetching");
  });

  it("schema rejeita scope inválido", () => {
    expect(bulkDeleteSchema.safeParse({ scope: "nope" }).success).toBe(false);
    expect(bulkDeleteSchema.safeParse({ scope: "all_terminal" }).success).toBe(
      true
    );
  });
});
