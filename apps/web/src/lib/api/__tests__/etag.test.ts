import { describe, it, expect } from "vitest";
import { etagFor, ifMatchFails, withEtag } from "../etag";

describe("etagFor", () => {
  it("retorna formato W/'<16hex>'", () => {
    const e = etagFor({ updatedAt: new Date("2026-05-01T10:00:00Z") });
    expect(e).toMatch(/^W\/"[a-f0-9]{16}"$/);
  });

  it("é determinístico para mesmo input", () => {
    const a = etagFor({ updatedAt: new Date("2026-05-01"), version: 1 });
    const b = etagFor({ updatedAt: new Date("2026-05-01"), version: 1 });
    expect(a).toBe(b);
  });

  it("diferente quando updatedAt muda", () => {
    const a = etagFor({ updatedAt: new Date("2026-05-01"), version: 1 });
    const b = etagFor({ updatedAt: new Date("2026-05-02"), version: 1 });
    expect(a).not.toBe(b);
  });

  it("diferente quando version muda", () => {
    const a = etagFor({ updatedAt: new Date("2026-05-01"), version: 1 });
    const b = etagFor({ updatedAt: new Date("2026-05-01"), version: 2 });
    expect(a).not.toBe(b);
  });

  it("aceita updatedAt como string ISO", () => {
    const a = etagFor({ updatedAt: "2026-05-01T10:00:00.000Z" });
    const b = etagFor({ updatedAt: new Date("2026-05-01T10:00:00.000Z") });
    expect(a).toBe(b);
  });
});

describe("ifMatchFails", () => {
  it("retorna false quando If-Match ausente (cliente abriu mão)", () => {
    const req = new Request("http://localhost");
    expect(ifMatchFails(req, 'W/"abc"')).toBe(false);
  });

  it("retorna false quando If-Match bate", () => {
    const req = new Request("http://localhost", {
      headers: { "If-Match": 'W/"abc"' },
    });
    expect(ifMatchFails(req, 'W/"abc"')).toBe(false);
  });

  it("retorna true quando If-Match não bate (precondition failed)", () => {
    const req = new Request("http://localhost", {
      headers: { "If-Match": 'W/"old"' },
    });
    expect(ifMatchFails(req, 'W/"new"')).toBe(true);
  });
});

describe("withEtag", () => {
  it("anexa header ETag preservando body", () => {
    const { body, init } = withEtag({ ok: true }, 'W/"abc"');
    expect(body).toEqual({ ok: true });
    const headers = init.headers as Headers;
    expect(headers.get("ETag")).toBe('W/"abc"');
  });

  it("preserva headers existentes do init", () => {
    const { init } = withEtag(
      {},
      'W/"abc"',
      { headers: { "X-Custom": "y" } }
    );
    const headers = init.headers as Headers;
    expect(headers.get("X-Custom")).toBe("y");
    expect(headers.get("ETag")).toBe('W/"abc"');
  });
});
