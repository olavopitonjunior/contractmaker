/**
 * Onde áudio e imagem do WhatsApp viram texto para o Max.
 *
 * O que este arquivo protege são as fronteiras, não a qualidade da
 * transcrição (essa é do Gemini): que a rota só aceite BYTES e nunca uma URL
 * escolhida por terceiro, que recuse formato e tamanho ANTES de gastar modelo,
 * e que os mesmos três gates da busca na base valham aqui — entitlement, kill
 * switch e teto de custo.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { __resetAgentProfileCacheForTests } from "@/lib/ai/agents/resolve";
import { transcribeMedia, MAX_MEDIA_BYTES } from "@/lib/ai/media-transcribe";

vi.mock("@/lib/auth/impersonation", () => ({
  getImpersonationFor: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/ai/media-transcribe", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/media-transcribe")>()),
  transcribeMedia: vi.fn(),
}));

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);
const transcribe = vi.mocked(transcribeMedia);

function req(body: unknown, token?: string) {
  return new NextRequest("http://localhost/api/agents/media/transcribe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function tokenComEscopos(scopes: string[]) {
  mockPrisma.userApiToken.findUnique.mockResolvedValue({
    id: "tok-1",
    userId: "user-1",
    scopes,
    revokedAt: null,
    expiresAt: null,
  } as never);
}

const AUDIO = Buffer.from("fake-ogg-bytes").toString("base64");
const OK = {
  agentKey: "max",
  kind: "audio",
  mimeType: "audio/ogg; codecs=opus",
  data: AUDIO,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.orgModule.findMany.mockResolvedValue([
    { module: "vendas", enabled: true, featureFlags: { "vendas.max": true } },
  ] as never);
  __resetAgentProfileCacheForTests();
  mockAuth.mockResolvedValue(null as never);
  mockGetUserOrg.mockResolvedValue({ id: "org-1" } as never);
  mockPrisma.userApiToken.update.mockResolvedValue({} as never);
  mockPrisma.agentProfile.findFirst.mockResolvedValue(null as never);
  mockPrisma.agentProfile.findUnique.mockResolvedValue(null as never);
  mockPrisma.aIUsage.aggregate.mockResolvedValue({
    _sum: { estimatedCostUsd: 0 },
  } as never);
  transcribe.mockResolvedValue({ text: "bom dia, o contrato saiu?", model: "gemini-2.5-flash" });
});

describe("POST /api/agents/media/transcribe", () => {
  it("401 sem autenticação nenhuma", async () => {
    expect((await POST(req(OK))).status).toBe(401);
  });

  it("403 com token sem o escopo agents:r", async () => {
    tokenComEscopos(["locacao:rw"]);
    expect((await POST(req(OK, "cmt_x"))).status).toBe(403);
  });

  it("transcreve áudio e devolve o texto", async () => {
    tokenComEscopos(["agents:r"]);

    const res = await POST(req(OK, "cmt_x"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      text: "bom dia, o contrato saiu?",
      kind: "audio",
    });
    expect(transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", kind: "audio" })
    );
  });

  /**
   * A mídia da Z-API vem por LINK. Aceitar o link faria este servidor buscar
   * uma URL escolhida por terceiro, com credencial de tenant — SSRF pela porta
   * da frente. O schema não tem campo de URL, e este teste é o que impede
   * alguém de adicionar um "por conveniência".
   */
  it("não aceita URL no lugar dos bytes", async () => {
    tokenComEscopos(["agents:r"]);

    const res = await POST(
      req(
        { agentKey: "max", kind: "audio", mimeType: "audio/ogg", url: "http://interno/segredo" },
        "cmt_x"
      )
    );

    expect(res.status).toBe(400);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("415 pra formato não suportado, sem gastar modelo", async () => {
    tokenComEscopos(["agents:r"]);

    const res = await POST(
      req({ ...OK, mimeType: "application/pdf" }, "cmt_x")
    );

    expect(res.status).toBe(415);
    expect(transcribe).not.toHaveBeenCalled();
  });

  /**
   * O corpo da Vercel para em 4.5 MB e base64 infla 33%. Recusar com motivo é
   * melhor que estourar no meio — e a conta é sobre os bytes DECODIFICADOS,
   * porque é o que o modelo vê.
   */
  it("413 pra mídia grande demais, sem gastar modelo", async () => {
    tokenComEscopos(["agents:r"]);
    const grande = Buffer.alloc(MAX_MEDIA_BYTES + 1).toString("base64");

    const res = await POST(req({ ...OK, data: grande }, "cmt_x"));

    expect(res.status).toBe(413);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("400 pra agente INTERNO, mesmo com escopo válido", async () => {
    tokenComEscopos(["agents:r"]);

    const res = await POST(req({ ...OK, agentKey: "legal" }, "cmt_x"));

    expect(res.status).toBe(400);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("403 quando o tenant não tem o Max contratado", async () => {
    tokenComEscopos(["agents:r"]);
    mockPrisma.orgModule.findMany.mockResolvedValue([
      { module: "vendas", enabled: true, featureFlags: {} },
    ] as never);

    const res = await POST(req(OK, "cmt_x"));

    expect(res.status).toBe(403);
    expect(transcribe).not.toHaveBeenCalled();
  });

  /**
   * Transcrição gasta Gemini. Sem este gate o teto mensal seria contornável
   * pelo caminho barato-mas-frequente — um áudio por mensagem no WhatsApp.
   */
  it("402 quando o teto do agente estourou, sem gastar modelo", async () => {
    tokenComEscopos(["agents:r"]);
    // O teto só existe quando o tenant configurou um: sem `monthlyBudgetUsd`
    // o guard não tem contra o que comparar e deixa passar de propósito.
    mockPrisma.agentProfile.findUnique.mockResolvedValue({
      orgId: "org-1",
      agentKey: "max",
      enabled: true,
      monthlyBudgetUsd: 10,
    } as never);
    mockPrisma.aIUsage.aggregate.mockResolvedValue({
      _sum: { estimatedCostUsd: 12 },
    } as never);

    const res = await POST(req(OK, "cmt_x"));

    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: "AGENT_BUDGET_EXCEEDED" });
    expect(transcribe).not.toHaveBeenCalled();
  });

  /**
   * 502 e não 500: quem falhou foi o provedor. O Max distingue os dois — um é
   * "avise a pessoa que não consegui ouvir", o outro é bug dele.
   */
  it("502 quando o provedor não devolve transcrição", async () => {
    tokenComEscopos(["agents:r"]);
    transcribe.mockResolvedValue(null);

    const res = await POST(req(OK, "cmt_x"));

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "TRANSCRIPTION_FAILED" });
  });

  it("aceita imagem também", async () => {
    tokenComEscopos(["agents:r"]);
    transcribe.mockResolvedValue({ text: "Uma matrícula de imóvel.", model: "gemini-2.5-flash" });

    const res = await POST(
      req({ ...OK, kind: "image", mimeType: "image/jpeg" }, "cmt_x")
    );

    expect(res.status).toBe(200);
    expect(transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "image" })
    );
  });
});
