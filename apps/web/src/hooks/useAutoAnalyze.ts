"use client";

import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";

const IDLE_MS = 30_000; // wait 30s after last edit before re-analyzing
const MAX_WAIT_MS = 60_000; // force an analysis at most once per 60s
const POLL_INTERVAL_MS = 5_000; // check every 5s
// Em modo Google Docs não há evento "edit" do editor (iframe externo). Re-analisa
// no máximo a cada GDOCS_REFRESH_MS para captar edições humanas no Drive sem
// torrar quota da Anthropic. O server lê o doc live via getDocPlainText.
const GDOCS_REFRESH_MS = 90_000;

type AutoAnalyzeMode = "tiptap" | "google_docs";

interface UseAutoAnalyzeOptions {
  /**
   * Called after a successful analysis run. Use to refresh the comments panel.
   */
  onAnalysisComplete?: (result: { commentsCreated: number; modelUsed: string }) => void;
  /**
   * "tiptap" (default) usa o editor.getHTML() como fonte de verdade do conteúdo.
   * "google_docs" dispara análises sem editor — o servidor lê o doc via Drive
   * export (getDocPlainText). Não envia htmlContent no body.
   */
  mode?: AutoAnalyzeMode;
}

/**
 * Client-side passive analysis hook. Runs an initial analysis when the editor
 * becomes ready (trigger=open), then re-runs with trigger=edit after the user
 * stops typing for IDLE_MS (or at least MAX_WAIT_MS has passed since the last
 * analysis).
 *
 * Uses a debounced polling strategy instead of per-keystroke listeners so the
 * TipTap update event stays cheap. Cancels in-flight requests on unmount.
 *
 * Em mode="google_docs" o `editor` é null (iframe externo). Disparamos a
 * análise inicial logo no mount e re-executamos a cada GDOCS_REFRESH_MS para
 * captar edições feitas dentro do iframe.
 */
export function useAutoAnalyze(
  editor: Editor | null,
  contractId: string | null,
  enabled: boolean,
  options: UseAutoAnalyzeOptions = {}
) {
  const mode: AutoAnalyzeMode = options.mode ?? "tiptap";
  const lastEditAt = useRef<number>(0);
  // Última análise BEM-SUCEDIDA — governa o hash de comparação no modo TipTap.
  const lastAnalysisAt = useRef<number>(0);
  // Última TENTATIVA (success OU error). Governa o gate de tempo no polling
  // pra evitar que respostas 503 do LLM transformem o intervalo de 90s em
  // ~5s (lastAnalysisAt fica em 0 e o gate dispara a cada poll).
  const lastAttemptAt = useRef<number>(0);
  const lastAnalyzedHash = useRef<string>("");
  const inFlight = useRef<AbortController | null>(null);
  const hasRunInitial = useRef<boolean>(false);

  // Keep latest callback in a ref so the polling effect doesn't restart
  // every render when the parent passes a new closure.
  const completeRef = useRef(options.onAnalysisComplete);
  useEffect(() => {
    completeRef.current = options.onAnalysisComplete;
  });

  // Track edit timestamps via editor update event (TipTap only)
  useEffect(() => {
    if (mode !== "tiptap") return;
    if (!editor || !enabled) return;
    const handler = () => {
      lastEditAt.current = Date.now();
    };
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [editor, enabled, mode]);

  // Trigger initial analysis and poll for edit-driven re-analysis
  useEffect(() => {
    if (!contractId || !enabled) return;
    if (mode === "tiptap" && !editor) return;

    async function runAnalysis(
      trigger: "open" | "edit",
      scope?: { changedText?: string }
    ) {
      if (!contractId) return;
      if (inFlight.current) {
        inFlight.current.abort();
      }
      // Marca a tentativa ANTES da request — assim o gate de tempo respeita
      // o intervalo mesmo se o servidor responder 503 ou levar 60s.
      lastAttemptAt.current = Date.now();
      const controller = new AbortController();
      inFlight.current = controller;
      try {
        // Em GDocs não enviamos htmlContent — o server puxa via Drive.
        const currentHtml = mode === "tiptap" ? editor?.getHTML() ?? "" : null;
        const res = await fetch(`/api/contracts/${contractId}/auto-analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trigger,
            scope,
            ...(currentHtml ? { htmlContent: currentHtml } : {}),
          }),
          signal: controller.signal,
        });
        if (res.ok) {
          const data = await res.json();
          lastAnalysisAt.current = Date.now();
          if (mode === "tiptap" && editor) {
            lastAnalyzedHash.current = editor.getHTML();
          }
          completeRef.current?.({
            commentsCreated: data.commentsCreated || 0,
            modelUsed: data.modelUsed || "unknown",
          });
        }
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          console.error("[useAutoAnalyze] Analysis failed:", err);
        }
      } finally {
        if (inFlight.current === controller) {
          inFlight.current = null;
        }
      }
    }

    // Initial analysis on first render
    if (!hasRunInitial.current) {
      hasRunInitial.current = true;
      if (mode === "tiptap" && editor) {
        lastAnalyzedHash.current = editor.getHTML();
      }
      runAnalysis("open");
    }

    // Polling loop
    const interval = setInterval(() => {
      const now = Date.now();
      // Para o gate de tempo, usa lastAttemptAt — qualquer terminação (success
      // ou error) conta. Isso evita rajadas de retry quando o LLM responde 503.
      const timeSinceAttempt = now - lastAttemptAt.current;

      if (mode === "google_docs") {
        // Sem evento de edit no iframe — re-analisa em cadência fixa.
        if (timeSinceAttempt >= GDOCS_REFRESH_MS) {
          runAnalysis("edit");
        }
        return;
      }

      if (!editor) return;
      const timeSinceEdit = now - lastEditAt.current;
      const currentHtml = editor.getHTML();
      const hasNewChanges = currentHtml !== lastAnalyzedHash.current;

      if (!hasNewChanges) return;

      // No TipTap, lastAnalysisAt (sucesso) ainda é válido pra "houve nova
      // edição depois da última análise OK?" — mas o disparo só acontece se
      // a tentativa anterior já passou do limite (idle/max-wait).
      const shouldRun =
        (timeSinceEdit >= IDLE_MS &&
          lastEditAt.current > lastAnalysisAt.current &&
          timeSinceAttempt >= IDLE_MS) ||
        (lastEditAt.current > lastAnalysisAt.current &&
          timeSinceAttempt >= MAX_WAIT_MS);

      if (shouldRun) {
        runAnalysis("edit");
      }
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      if (inFlight.current) {
        inFlight.current.abort();
      }
    };
  }, [editor, contractId, enabled, mode]);
}
