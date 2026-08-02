/**
 * `streamOneTurn` — roda UMA chamada `messages.create` em streaming e emite
 * eventos `text_delta` pelo generator. Acumula content blocks pra continuar
 * o loop tool-use no chamador.
 *
 * Compartilhado entre o agent.ts legacy e os especialistas do graph
 * multi-agente. Cada especialista chama isso quantas vezes seu max
 * iterations permitir.
 */

import type { Anthropic } from "@anthropic-ai/sdk";
import { getAnthropicClient, isOverloadedError } from "./anthropic-client";
import type { AgentEvent } from "../types";

export interface StreamedTurnResult {
  contentBlocks: Anthropic.ContentBlock[];
  stopReason: Anthropic.Message["stop_reason"] | null;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
}

export async function* streamOneTurn(
  params: Anthropic.MessageCreateParamsStreaming,
  opts: {
    /**
     * Modelo de contingência para 429/529 (`AgentProfile.fallbackModel`).
     * UMA tentativa, não uma cadeia — ver a nota em `anthropic-client.ts`.
     */
    fallbackModel?: string | null;
    /** Avisa o caller de que o turn rodou no fallback (pra registrar em AIUsage). */
    onFallback?: (info: { from: string; to: string; reason: string }) => void;
  } = {}
): AsyncGenerator<AgentEvent, StreamedTurnResult, void> {
  const anthropic = getAnthropicClient();

  let stream: Awaited<ReturnType<typeof anthropic.messages.create>>;
  try {
    stream = await anthropic.messages.create(params);
  } catch (err) {
    const podeTentarDeNovo =
      isOverloadedError(err) &&
      !!opts.fallbackModel &&
      opts.fallbackModel !== params.model;
    if (!podeTentarDeNovo) throw err;

    const reason = (err as { status?: number })?.status
      ? `HTTP ${(err as { status?: number }).status}`
      : "overloaded";
    console.warn(
      `[turn] ${params.model} sobrecarregado (${reason}) — tentando ${opts.fallbackModel}`
    );
    opts.onFallback?.({
      from: params.model,
      to: opts.fallbackModel!,
      reason,
    });
    // Motor de alerta, SÓ digest: fallback é degradação, não bloqueio — o
    // usuário foi atendido. Vale saber que aconteceu (e quantas vezes), não
    // vale um e-mail por ocorrência. Aqui porque este é o único ponto por
    // onde todo fallback passa.
    import("@/lib/alerts/platform-alerts")
      .then(({ reportPlatformAlert }) =>
        reportPlatformAlert({
          kind: "ai_budget",
          signature: `fallback:${params.model}`,
          severity: "info",
          title: `Modelo ${params.model} em fallback por sobrecarga (${reason})`,
          payload: { to: opts.fallbackModel, reason },
          notify: "digest",
        })
      )
      .catch(() => {});
    stream = await anthropic.messages.create({
      ...params,
      model: opts.fallbackModel!,
    });
  }

  const contentBlocks: Anthropic.ContentBlock[] = [];
  let currentText = "";
  let currentToolUse:
    | { id: string; name: string; jsonBuf: string }
    | null = null;
  let stopReason: Anthropic.Message["stop_reason"] | null = null;
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  for await (const evt of stream) {
    if (evt.type === "message_start") {
      usage.input += evt.message.usage?.input_tokens ?? 0;
      const u = evt.message.usage as {
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
      usage.cacheRead += u?.cache_read_input_tokens ?? 0;
      usage.cacheWrite += u?.cache_creation_input_tokens ?? 0;
    } else if (evt.type === "content_block_start") {
      const cb = evt.content_block;
      if (cb.type === "text") {
        currentText = "";
      } else if (cb.type === "tool_use") {
        currentToolUse = { id: cb.id, name: cb.name, jsonBuf: "" };
      }
    } else if (evt.type === "content_block_delta") {
      const d = evt.delta;
      if (d.type === "text_delta") {
        currentText += d.text;
        yield { type: "text_delta", text: d.text };
      } else if (d.type === "input_json_delta" && currentToolUse) {
        currentToolUse.jsonBuf += d.partial_json;
      }
    } else if (evt.type === "content_block_stop") {
      if (currentToolUse) {
        let input: Record<string, unknown> = {};
        if (currentToolUse.jsonBuf) {
          try {
            input = JSON.parse(currentToolUse.jsonBuf) as Record<string, unknown>;
          } catch {
            // Buf incompleto / inválido — manda input vazio, handler trata.
          }
        }
        contentBlocks.push({
          type: "tool_use",
          id: currentToolUse.id,
          name: currentToolUse.name,
          input,
        });
        currentToolUse = null;
      } else if (currentText) {
        contentBlocks.push({
          type: "text",
          text: currentText,
          citations: null,
        } as unknown as Anthropic.ContentBlock);
        currentText = "";
      }
    } else if (evt.type === "message_delta") {
      stopReason = evt.delta.stop_reason;
      usage.output += evt.usage?.output_tokens ?? 0;
    }
  }

  return { contentBlocks, stopReason, usage };
}
