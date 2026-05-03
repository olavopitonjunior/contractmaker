import { describe, it, expect } from "vitest";
import { resolveNewtonActor, isRejection, mergeAuditMetadata } from "../newton";
import type { ResolvedAuth } from "@/lib/auth/auth-or-bearer";

function makeReq(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/test", { headers });
}

const sessionIdent: ResolvedAuth = {
  via: "session",
  userId: "u1",
  email: "x@y.com",
};

const bearerIdent: ResolvedAuth = {
  via: "bearer",
  userId: "u1",
  tokenId: "t1",
  scopes: ["deals:rw"],
};

describe("resolveNewtonActor", () => {
  it("session + no header → ator é session.userId, sem via", () => {
    const r = resolveNewtonActor(makeReq(), sessionIdent);
    expect(isRejection(r)).toBe(false);
    if (!isRejection(r)) {
      expect(r.via).toBeUndefined();
      expect(r.effectiveUserId).toBe("u1");
    }
  });

  it("session + header presente → REJEITA (UI não deveria mandar header)", () => {
    const r = resolveNewtonActor(
      makeReq({ "x-newton-actor": "u1" }),
      sessionIdent
    );
    expect(isRejection(r)).toBe(true);
    if (isRejection(r)) {
      expect(r.reason).toBe("header_without_bearer");
    }
  });

  it("bearer + sem header → via=newton, ator é dono do token", () => {
    const r = resolveNewtonActor(makeReq(), bearerIdent);
    expect(isRejection(r)).toBe(false);
    if (!isRejection(r)) {
      expect(r.via).toBe("newton");
      expect(r.effectiveUserId).toBe("u1");
    }
  });

  it("bearer + header igual ao token.userId → via=newton", () => {
    const r = resolveNewtonActor(
      makeReq({ "x-newton-actor": "u1" }),
      bearerIdent
    );
    expect(isRejection(r)).toBe(false);
    if (!isRejection(r)) {
      expect(r.via).toBe("newton");
    }
  });

  it("bearer + header diferente do token.userId → REJEITA spoofing", () => {
    const r = resolveNewtonActor(
      makeReq({ "x-newton-actor": "u2" }),
      bearerIdent
    );
    expect(isRejection(r)).toBe(true);
    if (isRejection(r)) {
      expect(r.reason).toBe("header_user_mismatch");
    }
  });
});

describe("mergeAuditMetadata", () => {
  it("adiciona via=newton quando presente", () => {
    const merged = mergeAuditMetadata(
      { chargeId: "c1" },
      { via: "newton", effectiveUserId: "u1" }
    );
    expect(merged).toEqual({ chargeId: "c1", via: "newton" });
  });

  it("não adiciona via quando ausente", () => {
    const merged = mergeAuditMetadata(
      { chargeId: "c1" },
      { effectiveUserId: "u1" }
    );
    expect(merged).toEqual({ chargeId: "c1" });
    expect("via" in merged).toBe(false);
  });
});
