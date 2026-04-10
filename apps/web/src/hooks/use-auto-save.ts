"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function useAutoSave(
  token: string,
  data: Record<string, unknown>,
  debounceMs = 1500
) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>("");
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const save = useCallback(async (dataToSave: Record<string, unknown>) => {
    const serialized = JSON.stringify(dataToSave);
    if (serialized === lastSavedRef.current) return;

    setStatus("saving");
    try {
      const res = await fetch(`/api/forms/${token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataJson: dataToSave }),
      });

      if (!mountedRef.current) return;

      if (res.ok) {
        lastSavedRef.current = serialized;
        setStatus("saved");
        setTimeout(() => {
          if (mountedRef.current) setStatus("idle");
        }, 2000);
      } else {
        setStatus("error");
      }
    } catch {
      if (mountedRef.current) setStatus("error");
    }
  }, [token]);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    const serialized = JSON.stringify(data);
    if (serialized === lastSavedRef.current || serialized === "{}") return;

    timeoutRef.current = setTimeout(() => {
      save(data);
    }, debounceMs);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [data, debounceMs, save]);

  return { status, save: () => save(data) };
}
