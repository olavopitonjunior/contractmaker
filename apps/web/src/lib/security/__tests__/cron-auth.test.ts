import { describe, it, expect, afterEach } from "vitest";
import { requireCronAuth } from "../cron-auth";

const ORIG = process.env.CRON_SECRET;
afterEach(() => {
  if (ORIG === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIG;
});

function reqWith(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/cron/x", { headers });
}

describe("requireCronAuth", () => {
  it("503 quando CRON_SECRET não está no ambiente (fail-closed)", () => {
    delete process.env.CRON_SECRET;
    const res = requireCronAuth(reqWith({ authorization: "Bearer x" }));
    expect(res?.status).toBe(503);
  });

  it("401 sem header", () => {
    process.env.CRON_SECRET = "s3cr3t";
    const res = requireCronAuth(reqWith({}));
    expect(res?.status).toBe(401);
  });

  it("401 com secret errado", () => {
    process.env.CRON_SECRET = "s3cr3t";
    const res = requireCronAuth(reqWith({ authorization: "Bearer nope" }));
    expect(res?.status).toBe(401);
  });

  it("autoriza via Bearer correto", () => {
    process.env.CRON_SECRET = "s3cr3t";
    const res = requireCronAuth(reqWith({ authorization: "Bearer s3cr3t" }));
    expect(res).toBeNull();
  });

  it("autoriza via x-cron-secret", () => {
    process.env.CRON_SECRET = "s3cr3t";
    const res = requireCronAuth(reqWith({ "x-cron-secret": "s3cr3t" }));
    expect(res).toBeNull();
  });
});
