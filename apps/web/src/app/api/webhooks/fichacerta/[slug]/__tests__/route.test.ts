import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/security/ratelimit", () => ({
  RateLimits: { fichaCertaWebhookPerSlug: vi.fn().mockResolvedValue({ success: true }) },
}));
vi.mock("@/lib/security/audit", () => ({ audit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/fichacerta/account", () => ({
  decryptWebhookQuerySecret: vi.fn(() => "querysecret"),
  decryptWebhookTokenPassword: vi.fn(() => "tokenpass"),
}));
vi.mock("@/lib/credit/fichacerta-runner", () => ({
  reconcileCreditRequest: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn((p: Promise<unknown>) => p) }));

import { POST } from "../route";
import { POST as TOKEN } from "../token/route";
import { audit } from "@/lib/security/audit";
import { RateLimits } from "@/lib/security/ratelimit";
import { reconcileCreditRequest } from "@/lib/credit/fichacerta-runner";
import { issueWebhookToken } from "@/lib/fichacerta/webhook-auth";
import { prisma } from "@/lib/db/prisma";

const accountFind = prisma.fichaCertaAccount.findUnique as unknown as ReturnType<typeof vi.fn>;
const reqFindFirst = prisma.creditAnalysisRequest.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockAudit = vi.mocked(audit);

const ACCOUNT = { id: "acc1", orgId: "org1", webhookSlug: "slug1", webhookTokenUser: "fc_slug1" };
const params = { params: { slug: "slug1" } };
const PAYLOAD = { solicitacao: { id: 220, status: "CONCLUIDA" }, pretendentes: [{ pessoa: { id: 572, produtos: [{ status: "CONCLUIDO" }] }, laudo: {} }] };

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(url, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(RateLimits.fichaCertaWebhookPerSlug).mockResolvedValue({ success: true } as never);
  accountFind.mockResolvedValue(ACCOUNT);
  reqFindFirst.mockResolvedValue({ id: "req1", status: "processing" });
});

describe("POST /api/webhooks/fichacerta/[slug] — o que RECUSA", () => {
  it("slug desconhecido → 404", async () => {
    accountFind.mockResolvedValue(null);
    expect((await POST(post("https://x/api/webhooks/fichacerta/slug1", PAYLOAD), params)).status).toBe(404);
  });
  it("sem Bearer e sem ?k= → 401 auditado como CREDIT_WEBHOOK_REJECTED, sem reconciliar", async () => {
    const res = await POST(post("https://x/api/webhooks/fichacerta/slug1", PAYLOAD), params);
    expect(res.status).toBe(401);
    expect(mockAudit.mock.calls[0][1].action).toBe("CREDIT_WEBHOOK_REJECTED");
    expect(reconcileCreditRequest).not.toHaveBeenCalled();
  });
  it("?k= errado → 401; rate limit → 429", async () => {
    expect((await POST(post("https://x/w?k=errado", PAYLOAD), params)).status).toBe(401);
    vi.mocked(RateLimits.fichaCertaWebhookPerSlug).mockResolvedValue({ success: false } as never);
    expect((await POST(post("https://x/w?k=querysecret", PAYLOAD), params)).status).toBe(429);
  });
  it("autenticado mas JSON inválido → 400 (auditado como received/malformed)", async () => {
    const res = await POST(post("https://x/w?k=querysecret", "{nope"), params);
    expect(res.status).toBe(400);
    const rec = mockAudit.mock.calls.find((c) => c[1].action === "CREDIT_WEBHOOK_RECEIVED")!;
    expect(rec[1].metadata).toMatchObject({ malformed: true, via: "query" });
  });
});

describe("POST webhook — o que ACEITA", () => {
  it("?k= válido + solicitação conhecida → 200 e reconciliação com o payload", async () => {
    const res = await POST(post("https://x/w?k=querysecret", PAYLOAD), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, known: true });
    expect(reqFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: "org1", provider: "fichacerta", externalId: "220" } }));
    expect(reconcileCreditRequest).toHaveBeenCalledWith("req1", expect.objectContaining({ source: "webhook" }));
    const rec = mockAudit.mock.calls.find((c) => c[1].action === "CREDIT_WEBHOOK_RECEIVED")!;
    expect(rec[1].metadata).toMatchObject({ via: "query", known: true, solicitacaoId: "220" });
    expect(typeof (rec[1].metadata as { bodyHash: string }).bodyHash).toBe("string");
  });
  it("Bearer emitido pelo /token → 200; solicitação desconhecida → 200 known:false sem reconciliar", async () => {
    const { token } = issueWebhookToken("slug1", "querysecret");
    reqFindFirst.mockResolvedValue(null);
    const res = await POST(post("https://x/w", PAYLOAD, { authorization: `Bearer ${token}` }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, known: false });
    expect(reconcileCreditRequest).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks/fichacerta/[slug]/token", () => {
  it("par certo (JSON) → token Bearer que o webhook aceita; par errado → 401 auditado; slug desconhecido → 404", async () => {
    const ok = await TOKEN(post("https://x/t", { username: "fc_slug1", password: "tokenpass" }), params);
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.token_type).toBe("Bearer");
    const hook = await POST(post("https://x/w", PAYLOAD, { authorization: `Bearer ${body.access_token}` }), params);
    expect(hook.status).toBe(200);

    const bad = await TOKEN(post("https://x/t", { username: "fc_slug1", password: "x" }), params);
    expect(bad.status).toBe(401);
    expect(mockAudit.mock.calls.some((c) => c[1].action === "CREDIT_WEBHOOK_REJECTED")).toBe(true);

    accountFind.mockResolvedValue(null);
    expect((await TOKEN(post("https://x/t", { username: "a", password: "b" }), params)).status).toBe(404);
  });
  it("aceita form-urlencoded", async () => {
    const req = new NextRequest("https://x/t", { method: "POST", body: "username=fc_slug1&password=tokenpass", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    expect((await TOKEN(req, params)).status).toBe(200);
  });
});
