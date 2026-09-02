import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createMockSession, createMockOrg } from "@/__tests__/helpers";

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);

function makeReq() {
  return new NextRequest("http://localhost/api/intents/i-1/approve", {
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserOrg.mockResolvedValue(createMockOrg() as never);
});

describe("POST /api/intents/[id]/approve", () => {
  it("rejeita Bearer com 403 (HITL exige session)", async () => {
    // Bearer reach com auth-or-bearer requer mock de userApiToken
    const req = new NextRequest("http://localhost/api/intents/i-1/approve", {
      method: "POST",
      headers: { authorization: "Bearer cmt_x" },
    });
    mockPrisma.userApiToken.findUnique.mockResolvedValueOnce({
      id: "tk-1",
      userId: "u-1",
      scopes: [],
      revokedAt: null,
      expiresAt: null,
    } as never);
    mockPrisma.userApiToken.update.mockReturnValue({
      catch: vi.fn(),
    } as never);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "u-1",
      email: "u@x.com",
      name: "U",
    } as never);
    mockPrisma.orgMembership.findFirst.mockResolvedValue({
      orgId: "org-1",
    } as never);

    const res = await POST(req, { params: { id: "i-1" } });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.reason).toMatch(/session/);
  });

  it("rejeita 404 quando intent não existe", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.actionIntent.findUnique.mockResolvedValueOnce(null);
    const res = await POST(makeReq(), { params: { id: "i-1" } });
    expect(res.status).toBe(404);
  });

  it("rejeita 409 quando intent já não está pending", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.actionIntent.findUnique.mockResolvedValueOnce({
      id: "i-1",
      orgId: "org-1",
      requestedBy: "u-1",
      action: "CONTRACT_APPROVE",
      status: "executed",
      expiresAt: new Date(Date.now() + 60_000),
    } as never);
    const res = await POST(makeReq(), { params: { id: "i-1" } });
    expect(res.status).toBe(409);
  });

  // --- Permissão do aprovador (#520) ---
  // Até 2026-09-02 esta rota exigia sessão e mesma org, e mais nada: qualquer
  // membro aprovava intent de alto risco e disparava a execução. O par abaixo
  // é o contrato do conserto — sem o negativo, o positivo não afirma nada,
  // porque o mock global devolve `role: "owner"`, que tem tudo.

  it("NEGA viewer com 403 — o buraco que o gate fecha", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.orgMembership.findUnique.mockResolvedValueOnce({
      role: "viewer",
      customRole: null,
    } as never);
    const res = await POST(makeReq(), { params: { id: "i-1" } });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: "PERMISSION_DENIED",
      permission: "newton.intent.approve",
    });
  });

  it("NEGA antes de revelar se a intent existe", async () => {
    // O 403 tem de vir ANTES do 404/409/410: senão quem não pode aprovar
    // aprende, pelo código de status, se a intent existe e em que estado está.
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.orgMembership.findUnique.mockResolvedValueOnce({
      role: "viewer",
      customRole: null,
    } as never);
    // NÃO enfileirar `mockResolvedValueOnce` aqui: o gate nega antes de chamar,
    // então o valor ficaria pendente na fila e vazaria para o próximo teste —
    // `vi.clearAllMocks()` zera chamadas, mas NÃO consome implementações
    // `Once` não usadas. Foi assim que este arquivo quebrou o teste do 410.
    const res = await POST(makeReq(), { params: { id: "i-1" } });
    expect(res.status).toBe(403);
    expect(mockPrisma.actionIntent.findUnique).not.toHaveBeenCalled();
  });

  it("NEGA quem não é membro da org", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.orgMembership.findUnique.mockResolvedValueOnce(null as never);
    const res = await POST(makeReq(), { params: { id: "i-1" } });
    expect(res.status).toBe(403);
  });

  it("PERMITE gestor_locacao — preset que já declarava a permissão", async () => {
    // Este preset tem NEWTON_INTENT_APPROVE em roles.ts desde sempre; até
    // agora isso não significava nada, porque ninguém lia a chave.
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.orgMembership.findUnique.mockResolvedValueOnce({
      role: "gestor_locacao",
      customRole: null,
    } as never);
    mockPrisma.actionIntent.findUnique.mockResolvedValueOnce(null);
    const res = await POST(makeReq(), { params: { id: "i-1" } });
    expect(res.status).toBe(404); // passou do gate, morreu no 404 legítimo
  });

  it("rejeita 410 quando expirada", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.actionIntent.findUnique.mockResolvedValueOnce({
      id: "i-1",
      orgId: "org-1",
      requestedBy: "u-1",
      action: "CONTRACT_APPROVE",
      status: "pending",
      expiresAt: new Date(Date.now() - 60_000),
    } as never);
    mockPrisma.actionIntent.update.mockResolvedValue({} as never);
    const res = await POST(makeReq(), { params: { id: "i-1" } });
    expect(res.status).toBe(410);
  });
});
