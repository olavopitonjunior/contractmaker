import { describe, expect, it } from "vitest";
import {
  createInvitationSchema,
  formatInvitationValidationError,
} from "../invitation-schema";

describe("createInvitationSchema", () => {
  it("aceita convite só com e-mail (nome em branco no diálogo)", () => {
    // Payload exato que MembersPageClient envia quando o usuário preenche apenas
    // o e-mail — regressão: `name: ""` reprovava no .min(2) e devolvia 400.
    const parsed = createInvitationSchema.safeParse({
      email: "patricia@newcore.com.br",
      name: "",
      role: "finance",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.name).toBeUndefined();
      expect(parsed.data.role).toBe("finance");
    }
  });

  it("trata nome só de espaços como ausente", () => {
    const parsed = createInvitationSchema.safeParse({
      email: "patricia@newcore.com.br",
      name: "   ",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.name).toBeUndefined();
  });

  it("mantém o nome quando preenchido e usa role=member por padrão", () => {
    const parsed = createInvitationSchema.safeParse({
      email: "patricia@newcore.com.br",
      name: "  Patricia  ",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.name).toBe("Patricia");
      expect(parsed.data.role).toBe("member");
    }
  });

  it("ainda rejeita nome de 1 caractere", () => {
    const parsed = createInvitationSchema.safeParse({
      email: "patricia@newcore.com.br",
      name: "P",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejeita e-mail inválido", () => {
    const parsed = createInvitationSchema.safeParse({ email: "patricia@" });
    expect(parsed.success).toBe(false);
  });
});

describe("formatInvitationValidationError", () => {
  it("nomeia o campo reprovado", () => {
    const parsed = createInvitationSchema.safeParse({ email: "nao-e-email" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const msg = formatInvitationValidationError(parsed.error);
      expect(msg).toContain("email");
      expect(msg).not.toBe("Dados inválidos");
    }
  });
});
