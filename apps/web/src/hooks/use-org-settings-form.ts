"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type OrgSettingsSaveStatus = "idle" | "saving" | "saved" | "error";

/** Campos editáveis de Organization expostos por /api/org/fiscal-settings. */
export type OrgSettingsFields = Record<string, string | null | undefined>;

const ENDPOINT = "/api/org/fiscal-settings";

function norm(v: unknown): string {
  return (v ?? "").toString();
}

/**
 * Estado dos formulários que editam o cadastro da imobiliária (Organization) —
 * usado pelo perfil no onboarding e pelos dados fiscais em /settings.
 *
 * Resolve três problemas que derrubaram o cadastro da RE/MAX Ativa:
 *
 *  1. **Prefill fantasma.** O valor vinha de uma prop RSC calculada uma vez no
 *     load; remontar o form (trocar de passo no wizard) trazia o snapshot velho
 *     e os campos apareciam vazios sobre um banco cheio. Aqui o form hidrata do
 *     servidor (GET) — a prop `initial` é só o paint otimista.
 *
 *  2. **Wipe.** O form antigo mandava SEMPRE os 4 campos, inclusive `""`, e a
 *     rota grava string vazia. Salvar sobre a tela fantasma apagaria o cadastro.
 *     Aqui só vão no PATCH as chaves que o usuário de fato mexeu (diff contra a
 *     baseline hidratada) — um campo intocado nunca é transmitido. Apagar de
 *     propósito continua funcionando: o campo fica sujo.
 *
 *  3. **Rascunho perdido.** Sem autosave, o que era digitado e não confirmado
 *     no botão evaporava. Aqui salva sozinho após `debounceMs` sem digitação.
 */
export function useOrgSettingsForm<T extends OrgSettingsFields>(
  initial: T,
  opts: { debounceMs?: number; onSaved?: () => void } = {}
) {
  const debounceMs = opts.debounceMs ?? 1200;
  const onSavedRef = useRef(opts.onSaved);
  onSavedRef.current = opts.onSaved;

  const keys = useRef(Object.keys(initial) as (keyof T & string)[]).current;

  const [form, setForm] = useState<T>(initial);
  const [status, setStatus] = useState<OrgSettingsSaveStatus>("idle");
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Verdade do servidor. Só as chaves cujo valor DIVERGE daqui entram no PATCH.
  const baselineRef = useRef<Record<string, string>>(
    Object.fromEntries(keys.map((k) => [k, norm(initial[k])]))
  );
  // Campos que o usuário tocou — a hidratação não pode atropelar o que ele já
  // estava digitando enquanto o GET voava.
  const touchedRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // --- Hidratação: o servidor é a fonte da verdade, não a prop ---
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(ENDPOINT);
        if (!res.ok) throw new Error(String(res.status));
        const server = (await res.json()) as Record<string, unknown>;
        if (cancelled || !mountedRef.current) return;

        const next: Record<string, string> = {};
        for (const k of keys) next[k] = norm(server[k]);
        baselineRef.current = next;

        setForm((prev) => {
          const merged = { ...prev } as Record<string, unknown>;
          for (const k of keys) {
            if (!touchedRef.current.has(k)) merged[k] = next[k];
          }
          return merged as T;
        });
      } catch {
        // GET falhou: seguimos com a prop `initial` como baseline. O diff por
        // campo sujo ainda protege o que não foi tocado.
      } finally {
        if (!cancelled && mountedRef.current) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // keys é estável (ref); roda uma vez no mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirtyKeys = useCallback(
    (state: T): string[] =>
      keys.filter((k) => norm(state[k]).trim() !== (baselineRef.current[k] ?? "").trim()),
    [keys]
  );

  const persist = useCallback(
    async (state: T): Promise<boolean> => {
      const dirty = dirtyKeys(state);
      if (dirty.length === 0 || inFlightRef.current) return true;

      inFlightRef.current = true;
      setStatus("saving");
      setError(null);
      try {
        const payload = Object.fromEntries(dirty.map((k) => [k, norm(state[k]).trim()]));
        const res = await fetch(ENDPOINT, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error || "Falha ao salvar");
        }
        const saved = (await res.json()) as Record<string, unknown>;
        // Rebaseia com o que o servidor devolveu (a rota responde a linha nova).
        for (const k of keys) {
          baselineRef.current[k] = k in saved ? norm(saved[k]) : norm(state[k]).trim();
        }
        if (!mountedRef.current) return true;
        setStatus("saved");
        onSavedRef.current?.();
        setTimeout(() => {
          if (mountedRef.current) setStatus((s) => (s === "saved" ? "idle" : s));
        }, 2500);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setStatus("error");
        setError(err instanceof Error ? err.message : "Falha ao salvar");
        return false;
      } finally {
        inFlightRef.current = false;
      }
    },
    [dirtyKeys, keys]
  );

  // --- Autosave: debounce após a última tecla ---
  useEffect(() => {
    if (!hydrated) return;
    if (dirtyKeys(form).length === 0) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void persist(form), debounceMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [form, hydrated, debounceMs, persist, dirtyKeys]);

  const set = useCallback((key: keyof T & string, value: string) => {
    touchedRef.current.add(key);
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

  const patch = useCallback((values: Partial<Record<keyof T & string, string>>) => {
    for (const k of Object.keys(values)) touchedRef.current.add(k);
    setForm((f) => ({ ...f, ...values }));
  }, []);

  /** Flush imediato (botão "Salvar"). Devolve se persistiu sem erro. */
  const saveNow = useCallback(async (): Promise<boolean> => {
    if (timerRef.current) clearTimeout(timerRef.current);
    return persist(form);
  }, [persist, form]);

  return {
    form,
    set,
    patch,
    saveNow,
    status,
    error,
    hydrated,
    isDirty: dirtyKeys(form).length > 0,
  };
}
