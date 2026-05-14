"use client";

import { useEffect, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface VoiceInputButtonProps {
  form: UseFormReturn<Record<string, unknown>>;
  stepIndex: number;
  endpoint: string;
  /** Allowlist de chaves top-level pra mandar pro server (subtoken). */
  pathScope?: readonly string[];
  disabled?: boolean;
}

const PREFERRED_MIMES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/m4a",
];

function pickSupportedMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const mime of PREFERRED_MIMES) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    } catch {
      continue;
    }
  }
  return null;
}

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Aplica os valores extraídos pelo Gemini no formulário e dispara highlight
 * visual nos campos preenchidos. Retorna a quantidade efetivamente aplicada
 * (skipa paths com valor já existente em "dirty" — não sobrescreve trabalho
 * manual do usuário).
 */
function applyFields(
  form: UseFormReturn<Record<string, unknown>>,
  fields: Record<string, unknown>,
): string[] {
  const filledPaths: string[] = [];
  for (const [path, rawValue] of Object.entries(fields)) {
    if (rawValue === null || rawValue === undefined || rawValue === "") continue;
    const current = form.getValues(path as never) as unknown;
    if (current !== undefined && current !== null && current !== "") continue;
    form.setValue(path as never, rawValue as never, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    filledPaths.push(path);
  }
  return filledPaths;
}

function highlightFields(paths: string[]) {
  if (paths.length === 0) return;
  // Aguarda o RHF terminar de propagar setValue.
  window.setTimeout(() => {
    for (const path of paths) {
      const escaped = path.replace(/"/g, '\\"');
      const el = document.querySelector<HTMLElement>(`[name="${escaped}"]`);
      if (el) {
        el.setAttribute("data-voice-filled", "true");
        window.setTimeout(() => {
          el.removeAttribute("data-voice-filled");
        }, 3000);
      }
    }
  }, 50);
}

/**
 * Botão "🎤 Falar" no topo de cada step do form. Grava áudio do mic do
 * browser e envia pro endpoint que retorna paths pra preencher.
 *
 * Visual:
 *   - Idle: outline button "🎤 Falar"
 *   - Recording: pulsing red dot + timer + tap to stop
 *   - Uploading: spinner
 *
 * Acessibilidade: aria-live no tempo de gravação, aria-pressed pra estado.
 */
export function VoiceInputButton({
  form,
  stepIndex,
  endpoint,
  pathScope,
  disabled,
}: VoiceInputButtonProps) {
  const [state, setState] = useState<"idle" | "recording" | "uploading">("idle");
  const [elapsed, setElapsed] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      // Cleanup ao desmontar — para timer + libera stream
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function start() {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      toast.error("Seu navegador não suporta gravação de áudio.");
      return;
    }
    const mime = pickSupportedMime();
    if (!mime) {
      toast.error("Nenhum formato de áudio compatível encontrado.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime });
        chunksRef.current = [];
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        void upload(blob, mime);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setState("recording");
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch (err) {
      console.error("[VoiceInputButton] getUserMedia falhou:", err);
      toast.error("Permita acesso ao microfone para usar a entrada por voz.");
    }
  }

  function stop() {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function upload(blob: Blob, mime: string) {
    setState("uploading");
    try {
      const fd = new FormData();
      // Vercel multipart aceita .webm com type genérico — manda o mime
      // explicito no File pra server validar.
      const file = new File([blob], `voice-step${stepIndex}.${mime.includes("mp4") ? "mp4" : "webm"}`, {
        type: mime,
      });
      fd.append("audio", file);
      fd.append("stepIndex", String(stepIndex));
      if (pathScope && pathScope.length > 0) {
        fd.append("pathScope", JSON.stringify(pathScope));
      }
      const res = await fetch(endpoint, {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429) {
          toast.error("Limite de gravações por hora atingido.");
        } else {
          toast.error(data?.error ?? "Falha ao processar áudio");
        }
        return;
      }
      const fields = (data.fields ?? {}) as Record<string, unknown>;
      const filled = applyFields(form, fields);
      if (filled.length === 0) {
        toast.info("Nada novo identificado no áudio.");
      } else {
        highlightFields(filled);
        toast.success(
          `${filled.length} ${filled.length === 1 ? "campo preenchido" : "campos preenchidos"} por voz`,
        );
      }
    } catch (err) {
      console.error("[VoiceInputButton] upload falhou:", err);
      toast.error("Erro de rede ao enviar áudio");
    } finally {
      setState("idle");
      setElapsed(0);
    }
  }

  if (state === "recording") {
    return (
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={stop}
        aria-pressed="true"
        className="gap-2"
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
        </span>
        <span aria-live="polite">{fmtTime(elapsed)}</span>
        <span>Parar</span>
      </Button>
    );
  }

  if (state === "uploading") {
    return (
      <Button type="button" variant="outline" size="sm" disabled>
        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
        Processando voz...
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={start}
      disabled={disabled}
      aria-pressed="false"
    >
      {disabled ? (
        <MicOff className="h-3.5 w-3.5 mr-1.5" />
      ) : (
        <Mic className="h-3.5 w-3.5 mr-1.5" />
      )}
      Falar
    </Button>
  );
}
