import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/max/gate", () => ({
  isMaxEnabledForOrg: vi.fn().mockResolvedValue(false),
  isMaxEnabledForDeal: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/newton/gate", () => ({
  isNewtonEnabledForOrg: vi.fn().mockResolvedValue(false),
  isNewtonEnabledForDeal: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/max/notify-trigger", () => ({
  triggerMaxNotify: vi.fn().mockResolvedValue({ status: "sent", id: "mx1" }),
}));
vi.mock("@/lib/newton/notify-trigger", () => ({
  triggerNewtonNotify: vi.fn().mockResolvedValue("sent"),
}));

import {
  resolveWhatsappAgent,
  dispatchWhatsappNotify,
} from "../whatsapp-router";
import { isMaxEnabledForOrg, isMaxEnabledForDeal } from "@/lib/max/gate";
import {
  isNewtonEnabledForOrg,
  isNewtonEnabledForDeal,
} from "@/lib/newton/gate";
import { triggerMaxNotify } from "@/lib/max/notify-trigger";
import { triggerNewtonNotify } from "@/lib/newton/notify-trigger";

const maxOrg = isMaxEnabledForOrg as unknown as ReturnType<typeof vi.fn>;
const maxDeal = isMaxEnabledForDeal as unknown as ReturnType<typeof vi.fn>;
const newtonOrg = isNewtonEnabledForOrg as unknown as ReturnType<typeof vi.fn>;
const newtonDeal = isNewtonEnabledForDeal as unknown as ReturnType<typeof vi.fn>;
const maxTrigger = triggerMaxNotify as unknown as ReturnType<typeof vi.fn>;
const newtonTrigger = triggerNewtonNotify as unknown as ReturnType<typeof vi.fn>;

function args(over: Record<string, unknown> = {}) {
  return {
    orgId: "org1",
    audience: "platform_user" as const,
    phone: "+5511987654321",
    recipientName: "Marcia",
    title: "Contrato pronto",
    body: "O contrato foi gerado.",
    orgName: "Imob Teste",
    dedupeKey: "log1",
    ...over,
  };
}

describe("resolveWhatsappAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    maxOrg.mockResolvedValue(false);
    maxDeal.mockResolvedValue(false);
    newtonOrg.mockResolvedValue(false);
    newtonDeal.mockResolvedValue(false);
  });

  it("sem nenhuma feature ligada devolve null (estado de fábrica)", async () => {
    expect(await resolveWhatsappAgent("org1")).toBeNull();
  });

  it("só Newton ligado → newton", async () => {
    newtonOrg.mockResolvedValue(true);
    expect(await resolveWhatsappAgent("org1")).toBe("newton");
  });

  it("só Max ligado → max", async () => {
    maxOrg.mockResolvedValue(true);
    expect(await resolveWhatsappAgent("org1")).toBe("max");
  });

  /**
   * Ligar os dois no mesmo módulo é configuração inválida — o destinatário
   * receberia a MESMA notificação de dois números. O catálogo não sabe expressar
   * exclusão mútua, então o desempate mora aqui, num lugar só.
   */
  it("os dois ligados: Max ganha, e o gate do Newton nem é consultado", async () => {
    maxOrg.mockResolvedValue(true);
    newtonOrg.mockResolvedValue(true);

    expect(await resolveWhatsappAgent("org1")).toBe("max");
    expect(newtonOrg).not.toHaveBeenCalled();
  });

  it("com dealKind usa o gate por módulo, não o da org", async () => {
    maxDeal.mockResolvedValue(true);

    expect(await resolveWhatsappAgent("org1", "locacao")).toBe("max");
    expect(maxDeal).toHaveBeenCalledWith("org1", "locacao");
    expect(maxOrg).not.toHaveBeenCalled();
  });

  /**
   * Falha de leitura de módulo vira "sem agente": não mandar é recuperável
   * (a linha fica `skipped` visível), mandar pelo agente errado não é.
   */
  it("erro na leitura de módulos degrada pra null em vez de estourar", async () => {
    maxOrg.mockRejectedValue(new Error("db fora"));
    newtonOrg.mockRejectedValue(new Error("db fora"));

    await expect(resolveWhatsappAgent("org1")).resolves.toBeNull();
  });
});

describe("dispatchWhatsappNotify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    maxTrigger.mockResolvedValue({ status: "sent", id: "mx1" });
    newtonTrigger.mockResolvedValue("sent");
  });

  it("no Max manda título e corpo SEPARADOS (viram variáveis de template)", async () => {
    const r = await dispatchWhatsappNotify("max", args({ linkUrl: "/deals/1" }));

    expect(maxTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Contrato pronto",
        body: "O contrato foi gerado.",
        linkUrl: "/deals/1",
        dedupeKey: "log1",
      })
    );
    expect(r).toEqual({
      status: "sent",
      detail: { via: "max", maxNotifyId: "mx1" },
    });
  });

  /**
   * O turn do Newton recebe UMA frase. Preservar a composição exata importa:
   * é o texto que os tenants do Newton já leem hoje.
   */
  it("no Newton compõe a frase única, com o sufixo quando há", async () => {
    await dispatchWhatsappNotify(
      "newton",
      args({ newtonTrailer: "Acompanhe em https://x/deals/1" })
    );

    expect(newtonTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Contrato pronto: O contrato foi gerado. Acompanhe em https://x/deals/1",
      })
    );
  });

  it("sem sufixo a frase é só 'título: corpo'", async () => {
    await dispatchWhatsappNotify("newton", args());

    expect(newtonTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Contrato pronto: O contrato foi gerado.",
      })
    );
  });

  /**
   * `null` é significativo no Newton (o turn OMITE a menção à org); só o Max,
   * que precisa da variável de template, ganha o genérico.
   */
  it("orgName null passa reto pro Newton e vira genérico no Max", async () => {
    await dispatchWhatsappNotify("newton", args({ orgName: null }));
    expect(newtonTrigger).toHaveBeenCalledWith(
      expect.objectContaining({ orgName: null })
    );

    await dispatchWhatsappNotify("max", args({ orgName: null }));
    expect(maxTrigger).toHaveBeenCalledWith(
      expect.objectContaining({ orgName: "imobiliária" })
    );
  });

  it("audiência de parte não existe no Newton — recusa em vez de mandar errado", async () => {
    const r = await dispatchWhatsappNotify(
      "newton",
      args({ audience: "deal_party" })
    );

    expect(newtonTrigger).not.toHaveBeenCalled();
    expect(r).toEqual({
      status: "skipped",
      reason: "audiencia_party_nao_suportada_no_newton",
    });
  });

  it("propaga skipped e failed do Max sem traduzir", async () => {
    maxTrigger.mockResolvedValue({ status: "skipped", reason: "max_disabled" });
    expect(await dispatchWhatsappNotify("max", args())).toEqual({
      status: "skipped",
      reason: "max_disabled",
    });

    maxTrigger.mockResolvedValue({ status: "failed", error: "HTTP 500" });
    expect(await dispatchWhatsappNotify("max", args())).toEqual({
      status: "failed",
      error: "HTTP 500",
    });
  });
});
