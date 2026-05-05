import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("public/openapi.json", () => {
  const spec = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "public", "openapi.json"),
      "utf8"
    )
  );

  it("é OpenAPI 3.1", () => {
    expect(spec.openapi).toBe("3.1.0");
  });

  it("tem bearerAuth security scheme", () => {
    expect(spec.components?.securitySchemes?.bearerAuth?.type).toBe("http");
    expect(spec.components?.securitySchemes?.bearerAuth?.scheme).toBe("bearer");
  });

  it("inclui endpoints críticos pra Newton", () => {
    const paths = Object.keys(spec.paths ?? {});
    expect(paths).toContain("/api/me/metrics");
    expect(paths).toContain("/api/events");
    expect(paths).toContain("/api/contracts/{id}/approve");
    expect(paths).toContain("/api/contracts/{id}/envelopes");
    expect(paths).toContain("/api/deals/{dealId}/commission-charges");
    expect(paths).toContain("/api/intents/{id}");
  });

  it("approve/charges/envelopes documentam 202 com IntentPendingResponse", () => {
    const approve = spec.paths["/api/contracts/{id}/approve"]?.post;
    expect(approve?.responses?.["202"]).toBeDefined();
    const charge = spec.paths["/api/deals/{dealId}/commission-charges"]?.post;
    expect(charge?.responses?.["202"]).toBeDefined();
    const envelope = spec.paths["/api/contracts/{id}/envelopes"]?.post;
    expect(envelope?.responses?.["202"]).toBeDefined();
  });
});
