import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { withApi } from "@/lib/api/with-api";
import { resolveAgentProfile } from "@/lib/ai/agents/resolve";
import { assertAgentBudget, AgentBudgetExceededError } from "@/lib/ai/budget";
import { maxAgentRouteGate } from "@/lib/max/gate";
import {
  AGENT_REGISTRY,
  EXTERNAL_AGENT_KEYS,
  isExternalAgentKey,
} from "@/lib/ai/agents/registry";
import {
  transcribeMedia,
  isSupportedMime,
  MAX_MEDIA_BYTES,
  type MediaKind,
} from "@/lib/ai/media-transcribe";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  agentKey: z.string().min(1),
  kind: z.enum(["audio", "image"]),
  mimeType: z.string().min(1).max(128),
  /** Base64 do binário. Sem data-URI: o `mimeType` já vem em campo próprio. */
  data: z.string().min(1),
});

/**
 * POST /api/agents/media/transcribe
 *
 * Áudio e imagem que chegam ao Max por WhatsApp viram texto aqui.
 *
 * **Por que neste repo.** O serviço do Max tem credenciais próprias e
 * deliberadamente mínimas; transcrever lá exigiria uma `GEMINI_API_KEY` naquele
 * projeto — mais um segredo pra girar — e o custo sumiria do painel de
 * `AIUsage`, que é onde o dono vê quanto a IA gastou no mês dele. Aqui a chave,
 * o registro de custo e o teto por agente já existem. O Max paga uma hop de
 * rede e ganha os três de graça.
 *
 * **Recebe BYTES, não URL.** A mídia da Z-API vem por link, e mandar o link
 * faria este servidor buscar uma URL escolhida por terceiro — SSRF pela porta
 * da frente, com credencial de tenant. Quem baixa é o Max, que já falava com a
 * Z-API de qualquer jeito; aqui chega o conteúdo.
 *
 * Gates na mesma ordem de `/api/agents/knowledge/search`, e pelos mesmos
 * motivos: entitlement do tenant → kill switch do agente → teto de custo.
 * Transcrição gasta Gemini, então o teto vale aqui tanto quanto no RAG.
 *
 * Escopo `agents:r`, igual à busca na base: as duas gastam tokens e nenhuma
 * escreve no domínio do tenant.
 */
export const POST = withApi(
  "POST /api/agents/media/transcribe",
  async (req: NextRequest) => {
    const authed = await requireApiAuth(req, { scope: "agents:r" });
    if (isAuthFailure(authed)) return authFailureResponse(authed);
    const orgId = authed.org.id;

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Bad Request", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { agentKey, kind, mimeType, data } = parsed.data;

    if (!isExternalAgentKey(agentKey)) {
      return NextResponse.json(
        {
          error: "Bad Request",
          reason: "agentKey ausente ou não é um agente externo",
          allowed: EXTERNAL_AGENT_KEYS,
        },
        { status: 400 }
      );
    }

    if (!isSupportedMime(kind as MediaKind, mimeType)) {
      // 415, não 400: o pedido está bem formado, o formato é que não serve. A
      // distinção importa pro Max — 400 é bug dele, 415 é "avise a pessoa".
      return NextResponse.json(
        { error: "UNSUPPORTED_MEDIA_TYPE", reason: `mimeType não suportado: ${mimeType}` },
        { status: 415 }
      );
    }

    let bytes: Buffer;
    try {
      bytes = Buffer.from(data, "base64");
    } catch {
      return NextResponse.json(
        { error: "Bad Request", reason: "data não é base64 válido" },
        { status: 400 }
      );
    }

    // Conferido sobre os BYTES decodificados, não sobre o base64: é o tamanho
    // que o Gemini vê, e comparar a string inflada recusaria arquivos válidos.
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_MEDIA_BYTES) {
      return NextResponse.json(
        {
          error: "PAYLOAD_TOO_LARGE",
          reason: `mídia precisa ter entre 1 byte e ${MAX_MEDIA_BYTES} bytes (recebido: ${bytes.byteLength})`,
        },
        { status: 413 }
      );
    }

    const notEntitled = await maxAgentRouteGate({
      orgId,
      via: authed.ident.via,
      agentKey,
    });
    if (notEntitled) return notEntitled;

    const profile = await resolveAgentProfile(agentKey, orgId);
    if (!profile.enabled) {
      return NextResponse.json(
        {
          error: "AGENT_DISABLED",
          reason: `O agente "${AGENT_REGISTRY[agentKey].label}" está desligado para esta organização.`,
        },
        { status: 403 }
      );
    }

    try {
      await assertAgentBudget(orgId, agentKey);
    } catch (err) {
      if (err instanceof AgentBudgetExceededError) {
        return NextResponse.json(
          { error: "AGENT_BUDGET_EXCEEDED", reason: err.message },
          { status: 402 }
        );
      }
      throw err;
    }

    const result = await transcribeMedia({
      orgId,
      userId: authed.actor.effectiveUserId,
      kind: kind as MediaKind,
      mimeType,
      data: bytes,
    });

    if (!result) {
      // 502 e não 500: quem falhou foi o provedor, não esta rota. O Max trata
      // como "não consegui ouvir" e avisa a pessoa, em vez de calar.
      return NextResponse.json(
        { error: "TRANSCRIPTION_FAILED", reason: "não foi possível interpretar a mídia" },
        { status: 502 }
      );
    }

    return NextResponse.json({ text: result.text, model: result.model, kind });
  }
);
