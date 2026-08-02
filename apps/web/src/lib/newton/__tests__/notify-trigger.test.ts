import { describe, it, expect, afterEach, vi } from "vitest";
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

/**
 * O turn diz ao agente PARA QUAL NÚMERO enviar, e o `whatsapp_send` exige E.164
 * sem "+". Se o número embutido na instrução vier no formato do cadastro, o
 * agente repassa cru e a mensagem não chega — em silêncio, porque o turn devolve
 * ok. Foi o #189; o fix de então cobriu só a audiência `platform_user`.
 */
describe("telefone embutido no turn (regressão #189, audiência deal_broker)", () => {
  const CRU = "(11) 99906-3228";
  const E164_SEM_MAIS = "5511999063228";

  async function turnEnviado(audience: "deal_broker" | "platform_user") {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    vi.stubEnv("NEWTON_DISABLED", "false");
    vi.stubEnv("NEWTON_SIDECAR_URL", "https://sidecar.test");
    vi.stubEnv("NEWTON_SIDECAR_TOKEN", "tok");
    vi.doMock("@/lib/newton/gate", () => ({
      isNewtonEnabledForOrg: vi.fn().mockResolvedValue(true),
    }));
    const { triggerNewtonNotify } = await import("../notify-trigger");

    await triggerNewtonNotify({
      orgId: "org1",
      audience,
      phone: CRU,
      recipientName: "Carlos Corretor",
      message: "Contrato pronto: o contrato foi gerado.",
      dealId: "deal1",
      orgName: "Imob Teste",
    });

    return JSON.parse(fetchMock.mock.calls[0][1].body).text as string;
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock("@/lib/newton/gate");
  });

  it("manda o número normalizado — e nunca o formato do cadastro", async () => {
    const text = await turnEnviado("deal_broker");
    expect(text).toContain(`pro telefone ${E164_SEM_MAIS}`);
    expect(text).not.toContain(CRU);
  });

  it("a audiência platform_user segue normalizada (não regrediu)", async () => {
    const text = await turnEnviado("platform_user");
    expect(text).toContain(`pro telefone ${E164_SEM_MAIS}`);
    expect(text).not.toContain(CRU);
  });
});
