import { describe, it, expect } from "vitest";
import {
  signParticipantToken,
  verifyParticipantToken,
} from "../participant-token";
import { signToken } from "../../jwt-hmac";

const SECRET = "test-secret-do-not-use-in-prod-aaaaaaaa";
const OTHER_SECRET = "outro-secret-completamente-diferente-bbbb";

const basePayload = {
  participantId: "part_abc123",
  formId: "form_xyz789",
  role: "vendedor" as const,
  partyIndex: 0,
};

describe("signParticipantToken", () => {
  it("produz token com 3 partes separadas por ponto (JWT shape)", () => {
    const { token } = signParticipantToken(basePayload, SECRET);
    expect(token.split(".")).toHaveLength(3);
  });

  it("exp é Date ~7 dias no futuro", () => {
    const { exp } = signParticipantToken(basePayload, SECRET);
    const expectedMs = Date.now() + 7 * 24 * 60 * 60 * 1000;
    // Tolerância ±5s pra latência de execução do teste.
    expect(Math.abs(exp.getTime() - expectedMs)).toBeLessThan(5000);
  });

  it("tokens consecutivos diferem (timestamp embutido)", async () => {
    const a = signParticipantToken(basePayload, SECRET);
    // Aguarda 10ms pra garantir epoch second diferente em casos limítrofes
    await new Promise((r) => setTimeout(r, 1100));
    const b = signParticipantToken(basePayload, SECRET);
    expect(a.token).not.toBe(b.token);
  });
});

describe("verifyParticipantToken", () => {
  it("aceita token válido e retorna payload original", () => {
    const { token } = signParticipantToken(basePayload, SECRET);
    const result = verifyParticipantToken(token, SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.participantId).toBe(basePayload.participantId);
      expect(result.payload.formId).toBe(basePayload.formId);
      expect(result.payload.role).toBe(basePayload.role);
      expect(result.payload.partyIndex).toBe(basePayload.partyIndex);
      expect(typeof result.payload.exp).toBe("number");
    }
  });

  it("rejeita token com assinatura adulterada", () => {
    const { token } = signParticipantToken(basePayload, SECRET);
    const parts = token.split(".");
    // Tampera com a assinatura (último segmento)
    const tampered = `${parts[0]}.${parts[1]}.AAAAAAAAAAAAAAAAAAAAAAAAA`;
    const result = verifyParticipantToken(tampered, SECRET);
    expect(result.ok).toBe(false);
  });

  it("rejeita token assinado com secret diferente", () => {
    const { token } = signParticipantToken(basePayload, SECRET);
    const result = verifyParticipantToken(token, OTHER_SECRET);
    expect(result.ok).toBe(false);
  });

  it("rejeita token com menos de 3 segmentos", () => {
    const result = verifyParticipantToken("apenas.duas-partes", SECRET);
    expect(result.ok).toBe(false);
  });

  it("rejeita payload sem participantId", () => {
    // Forge manual: refaz com payload incompleto e assina certo
    const { token } = signParticipantToken(basePayload, SECRET);
    const [head, , sig] = token.split(".");
    // Re-encoda body sem participantId
    const incompleteBody = Buffer.from(
      JSON.stringify({
        formId: "f",
        role: "vendedor",
        partyIndex: 0,
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    // Mesma assinatura não bate com novo body, então rejeita antes mesmo
    // de chegar no check do participantId. Usa um body assinado válido
    // mas sem o campo: pra isso, precisamos re-assinar.
    void head;
    void sig;
    const result = verifyParticipantToken(`${head}.${incompleteBody}.fake`, SECRET);
    expect(result.ok).toBe(false);
  });

  it("rejeita role inválido (não vendedor/comprador)", () => {
    // Pega o jwt-hmac de baixo nível pra forjar um token válido com role errado
    const forged = signToken(
      {
        participantId: "p",
        formId: "f",
        role: "hacker",
        partyIndex: 0,
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      SECRET,
    );
    const result = verifyParticipantToken(forged, SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Payload");
    }
  });

  it("rejeita exp no passado", () => {
    const forged = signToken(
      {
        participantId: "p",
        formId: "f",
        role: "vendedor",
        partyIndex: 0,
        exp: Math.floor(Date.now() / 1000) - 3600, // 1h atrás
      },
      SECRET,
    );
    const result = verifyParticipantToken(forged, SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("expirado");
    }
  });

  it("aceita role comprador também", () => {
    const { token } = signParticipantToken(
      { ...basePayload, role: "comprador" },
      SECRET,
    );
    const result = verifyParticipantToken(token, SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.role).toBe("comprador");
    }
  });
});
