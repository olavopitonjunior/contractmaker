import { describe, it, expect } from "vitest";
import { checkM2mSurface } from "../preflight";
import { HIGH_RISK_ACTIONS } from "@/lib/api/intents";

describe("preflight — checkM2mSurface", () => {
  it("todo HIGH_RISK_ACTION tem executor registrado (blocker se faltar)", async () => {
    const results = await checkM2mSurface();
    const exec = results.find((r) => r.key === "intent_executors");
    expect(exec).toBeDefined();
    expect(exec!.severity).toBe("ok");
    expect(exec!.message).toContain(String(HIGH_RISK_ACTIONS.length));
  });

  it("chaves de SCOPE_LIMITS batem com o catálogo de scopes", async () => {
    const results = await checkM2mSurface();
    const scopes = results.find((r) => r.key === "scope_limits_keys");
    expect(scopes).toBeDefined();
    expect(scopes!.severity).toBe("ok");
  });
});
