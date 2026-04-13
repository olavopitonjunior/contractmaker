"use client";

import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";

const IDLE_MS = 30_000; // wait 30s after last edit before re-analyzing
const MAX_WAIT_MS = 60_000; // force an analysis at most once per 60s
const POLL_INTERVAL_MS = 5_000; // check every 5s

interface UseAutoAnalyzeOptions {
  /**
   * Called after a successful analysis run. Use to refresh the comments panel.
   */
  onAnalysisComplete?: (result: { commentsCreated: number; modelUsed: string }) => void;
}

/**
 * Client-side passive analysis hook. Runs an initial analysis when the editor
 * becomes ready (trigger=open), then re-runs with trigger=edit after the user
 * stops typing for IDLE_MS (or at least MAX_WAIT_MS has passed since the last
 * analysis).
 *
 * Uses a debounced polling strategy instead of per-keystroke listeners so the
 * TipTap update event stays cheap. Cancels in-flight requests on unmount.
 */
export function useAutoAnalyze(
  editor: Editor | null,
  contractId: string | null,
  enabled: boolean,
  options: UseAutoAnalyzeOptions = {}
) {
  const lastEditAt = useRef<number>(0);
  const lastAnalysisAt = useRef<number>(0);
  const lastAnalyzedHash = useRef<string>("");
  const inFlight = useRef<AbortController | null>(null);
  const hasRunInitial = useRef<boolean>(false);

  const { onAnalysisComplete } = options;

  // Track edit timestamps via editor update event
  useEffect(() => {
    if (!editor || !enabled) return;
    const handler = () => {
      lastEditAt.current = Date.now();
    };
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [editor, enabled]);

  // Trigger initial analysis and poll for edit-driven re-analysis
  useEffect(() => {
    if (!editor || !contractId || !enabled) return;

    async function runAnalysis(
      trigger: "open" | "edit",
      scope?: { changedText?: string }
    ) {
      if (!contractId) return;
      if (inFlight.current) {
        inFlight.current.abort();
      }
      const controller = new AbortController();
      inFlight.current = controller;
      try {
        const res = await fetch(`/api/contracts/${contractId}/auto-analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trigger, scope }),
          signal: controller.signal,
        });
        if (res.ok) {
          const data = await res.json();
          lastAnalysisAt.current = Date.now();
          if (editor) {
            lastAnalyzedHash.current = editor.getHTML();
          }
          onAnalysisComplete?.({
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
      lastAnalyzedHash.current = editor.getHTML();
      runAnalysis("open");
    }

    // Polling loop for edit-driven re-analysis
    const interval = setInterval(() => {
      if (!editor) return;
      const now = Date.now();
      const timeSinceEdit = now - lastEditAt.current;
      const timeSinceAnalysis = now - lastAnalysisAt.current;
      const currentHtml = editor.getHTML();
      const hasNewChanges = currentHtml !== lastAnalyzedHash.current;

      if (!hasNewChanges) return;

      const shouldRun =
        (timeSinceEdit >= IDLE_MS && lastEditAt.current > lastAnalysisAt.current) ||
        timeSinceAnalysis >= MAX_WAIT_MS;

      if (shouldRun) {
        // Extract the section that changed — simplest heuristic: find the
        // first block that differs between current and last analyzed html.
        // For the MVP, we send the full html and let the server slice.
        runAnalysis("edit");
      }
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      if (inFlight.current) {
        inFlight.current.abort();
      }
    };
  }, [editor, contractId, enabled, onAnalysisComplete]);
}
