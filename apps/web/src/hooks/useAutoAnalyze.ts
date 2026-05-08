"use client";

import { useEffect, useRef } from "react";

const POLL_INTERVAL_MS = 5_000;
// Em modo Google Docs não há evento "edit" do editor (iframe externo). Re-analisa
// no máximo a cada GDOCS_REFRESH_MS para captar edições humanas no Drive sem
// torrar quota da Anthropic. O server lê o doc live via getDocPlainText.
const GDOCS_REFRESH_MS = 90_000;

interface UseAutoAnalyzeOptions {
  /** Called after a successful analysis run. Use to refresh the comments panel. */
  onAnalysisComplete?: (result: { commentsCreated: number; modelUsed: string }) => void;
}

/**
 * Client-side passive analysis hook (GDocs-only). Dispara uma análise inicial
 * (`trigger=open`) ao montar e re-analisa a cada GDOCS_REFRESH_MS pra captar
 * edições feitas dentro do iframe Drive.
 *
 * O servidor lê o conteúdo live via `getDocPlainText(googleDocId)` — o cliente
 * não envia HTML.
 */
export function useAutoAnalyze(
  contractId: string | null,
  enabled: boolean,
  options: UseAutoAnalyzeOptions = {}
) {
  const lastAttemptAt = useRef<number>(0);
  const inFlight = useRef<AbortController | null>(null);
  const hasRunInitial = useRef<boolean>(false);

  const completeRef = useRef(options.onAnalysisComplete);
  useEffect(() => {
    completeRef.current = options.onAnalysisComplete;
  });

  useEffect(() => {
    if (!contractId || !enabled) return;

    async function runAnalysis(trigger: "open" | "edit") {
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
        const res = await fetch(`/api/contracts/${contractId}/auto-analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trigger }),
          signal: controller.signal,
        });
        if (res.ok) {
          const data = await res.json();
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
      runAnalysis("open");
    }

    // Polling fixo — re-analisa em cadência pra captar edições no Drive.
    const interval = setInterval(() => {
      const timeSinceAttempt = Date.now() - lastAttemptAt.current;
      if (timeSinceAttempt >= GDOCS_REFRESH_MS) {
        runAnalysis("edit");
      }
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      if (inFlight.current) {
        inFlight.current.abort();
      }
    };
  }, [contractId, enabled]);
}
