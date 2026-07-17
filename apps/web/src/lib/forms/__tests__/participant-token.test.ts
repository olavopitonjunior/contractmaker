import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  newParticipantToken,
  resolveParticipantToken,
} from "../participant-token";
import { prisma } from "@/lib/db/prisma";

const mockPrisma = vi.mocked(prisma);

/** Row de participante como o banco devolve. */
function row(over: Record<string, unknown> = {}) {
  return {
    id: "part_abc123",
    role: "vendedor",
    partyIndex: 0,
    formId: "form_xyz789",
    tokenExp: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    completedAt: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("newParticipantToken", () => {
  it("é curto e URL-safe — o link vai por WhatsApp", () => {
    // O motivo da mudança: o JWT anterior tinha ~257 chars e a URL passava de
    // 280. 16 bytes em base64url = 22 chars.
    const { token } = newParticipantToken();
    expect(token).toHaveLength(22);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("não tem ponto — o resolveFormScope não pode mais farejar pelo formato", () => {
    // A heurística `token.includes(".")` distinguia subtoken (JWT) de token
    // principal. Sumiu junto com o JWT; a desambiguação virou a ordem das
    // consultas. Este teste existe pra ninguém reintroduzir a heurística.
    const { token } = newParticipantToken();
    expect(token).not.toContain(".");
  });

  it("exp é ~7 dias no futuro", () => {
    const { exp } = newParticipantToken();
    const esperado = Date.now() + 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(exp.getTime() - esperado)).toBeLessThan(5000);
  });

  it("tokens são aleatórios, não derivados", () => {
    const tokens = new Set(
      Array.from({ length: 50 }, () => newParticipantToken().token)
    );
    expect(tokens.size).toBe(50);
  });
});

describe("resolveParticipantToken", () => {
  it("aceita token existente e devolve o participante", async () => {
    mockPrisma.salesFormParticipant.findUnique.mockResolvedValue(row() as never);
    const r = await resolveParticipantToken("KvA3gJpKkcDcm2pu7tDScw");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.participant.id).toBe("part_abc123");
      expect(r.participant.role).toBe("vendedor");
      expect(r.participant.formId).toBe("form_xyz789");
    }
  });

  it("JWT legado ainda resolve — links em circulação não quebram", async () => {
    // Os tokens antigos estão gravados na coluna `token`. Como a autenticação
    // virou uma busca por igualdade, pro banco eles são só uma string opaca
    // comprida. Sem isso, todo link já enviado a cliente viraria 401 no deploy.
    const jwtLegado =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJwYXJ0aWNpcGFudElkIjoicGFydF9hYmMxMjMifQ.assinatura";
    mockPrisma.salesFormParticipant.findUnique.mockResolvedValue(row() as never);

    const r = await resolveParticipantToken(jwtLegado);
    expect(r.ok).toBe(true);
    expect(mockPrisma.salesFormParticipant.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { token: jwtLegado } })
    );
  });

  it("token inexistente é rejeitado", async () => {
    mockPrisma.salesFormParticipant.findUnique.mockResolvedValue(null as never);
    const r = await resolveParticipantToken("naoexiste");
    expect(r.ok).toBe(false);
  });

  it("token regenerado invalida o antigo (o valor no DB é o canônico)", async () => {
    // "Regenerar link" grava outro token na row — o antigo deixa de existir.
    mockPrisma.salesFormParticipant.findUnique.mockResolvedValue(null as never);
    const r = await resolveParticipantToken("token-antigo-revogado");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/inválido ou revogado/i);
  });

  it("token vencido é rejeitado por tokenExp", async () => {
    // A expiração era o `exp` assinado no JWT; agora é a coluna.
    mockPrisma.salesFormParticipant.findUnique.mockResolvedValue(
      row({ tokenExp: new Date(Date.now() - 3600_000) }) as never
    );
    const r = await resolveParticipantToken("vencido");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/expirado/i);
  });

  it("token vazio não vai ao banco", async () => {
    const r = await resolveParticipantToken("");
    expect(r.ok).toBe(false);
    expect(mockPrisma.salesFormParticipant.findUnique).not.toHaveBeenCalled();
  });

  it("role desconhecido no banco é rejeitado", async () => {
    mockPrisma.salesFormParticipant.findUnique.mockResolvedValue(
      row({ role: "hacker" }) as never
    );
    const r = await resolveParticipantToken("qualquer");
    expect(r.ok).toBe(false);
  });

  it("falha do banco nega o acesso (fail-closed)", async () => {
    mockPrisma.salesFormParticipant.findUnique.mockRejectedValue(
      new Error("db down") as never
    );
    const r = await resolveParticipantToken("qualquer");
    expect(r.ok).toBe(false);
  });

  it("aceita os roles de locação", async () => {
    for (const role of ["locador", "locatario", "fiador"]) {
      mockPrisma.salesFormParticipant.findUnique.mockResolvedValue(
        row({ role }) as never
      );
      const r = await resolveParticipantToken("qualquer");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.participant.role).toBe(role);
    }
  });
});
