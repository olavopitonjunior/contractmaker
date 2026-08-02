import { describe, it, expect } from "vitest";
import { normalizeBrPhone } from "@/lib/validators/phone-br";

/**
 * Regressão do #189 estendida à audiência platform_user: o agente NÃO
 * normaliza telefone sozinho — repassa cru pro whatsapp_send, que exige E.164
 * SEM "+". No caminho do corretor o cadastro guarda formato livre; no caminho
 * do usuário o User.phone guarda E.164 COM "+" (normalizeBrPhone). Os dois
 * precisam do mesmo tratamento no trigger.
 */
describe("normalização do telefone antes do whatsapp_send", () => {
  const paraWhatsapp = (raw: string) =>
    normalizeBrPhone(raw)?.replace(/^\+/, "") ?? null;

  it("tira o + do User.phone (formato em que o perfil salva)", () => {
    expect(paraWhatsapp("+5511987654321")).toBe("5511987654321");
  });

  it("normaliza o formato livre do cadastro de corretor", () => {
    expect(paraWhatsapp("11999063228")).toBe("5511999063228");
    expect(paraWhatsapp("(11) 99906-3228")).toBe("5511999063228");
  });

  it("telefone inválido não vira envio para número quebrado", () => {
    expect(paraWhatsapp("123")).toBeNull();
  });
});
