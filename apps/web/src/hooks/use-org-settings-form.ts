"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type OrgSettingsSaveStatus = "idle" | "saving" | "saved" | "error";

/** Campos de texto do cadastro da org (perfil fiscal, identidade visual…). */
export type OrgSettingsFields = Record<string, string | null | undefined>;

/** Endpoint default — o cadastro fiscal/perfil da imobiliária. */
const DEFAULT_ENDPOINT = "/api/org/fiscal-settings";

/** ~3s de espera por um PATCH em voo antes de desistir do re-agendamento. */
const MAX_REQUEUES = 20;

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
 *
 * As três saídas do estado que o debounce sozinho não cobre — desmontar, editar
 * durante um PATCH em voo e tomar 4xx — são tratadas abaixo, cada uma no ponto
 * comentado. São as mesmas de `use-settings-auto-save.ts`, que já as pagou.
 */
export function useOrgSettingsForm<T extends OrgSettingsFields>(
  initial: T,
  opts: { debounceMs?: number; onSaved?: () => void; endpoint?: string } = {}
) {
  const debounceMs = opts.debounceMs ?? 1200;
  const ENDPOINT = opts.endpoint ?? DEFAULT_ENDPOINT;
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
  /** Há gravação agendada e ainda não disparada — o unmount precisa saber. */
  const pendingRef = useRef(false);
  /** 401/403/404 é veredito: para de tentar. Ver o tratamento em `persist`. */
  const stoppedRef = useRef(false);
  /** Valor corrente para quem persiste fora do render (unmount, re-agendamento). */
  const formRef = useRef(form);
  formRef.current = form;
  /** Tentativas seguidas de re-agendamento por PATCH em voo — ver `persist`. */
  const requeuesRef = useRef(0);
  /** Re-agendamento que já sobreviveu ao unmount; nenhuma limpeza o cancela. */
  const orphanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      // Desmontar no meio do debounce NÃO pode descartar a edição. Aqui o
      // caminho é comum: `AgencyProfileForm` vive num passo do wizard de
      // onboarding e em `/settings/perfil` — sair da página ou trocar de passo
      // dentro da janela de 1,2s perdia o que tinha sido digitado, em silêncio.
      // (O wizard já contornava isso mantendo o form montado e só escondido; a
      // correção aqui é na origem, e vale também para quem navega para fora.)
      // O fetch sobrevive ao unmount; só os setState é que não podem rodar, e
      // `mountedRef` já cuida disso.
      if (pendingRef.current) {
        pendingRef.current = false;
        void persistRef.current();
      }
    };
  }, []);

  // --- Hidratação: o servidor é a fonte da verdade, não a prop ---
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(ENDPOINT, { credentials: "include" });
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

  const persist = useCallback(async (): Promise<boolean> => {
    const state = formRef.current;
    const dirty = dirtyKeys(state);
    if (dirty.length === 0) return true;
    if (stoppedRef.current) return false;
    // Editar durante um PATCH em voo não pode sumir. Antes isto devolvia `true`
    // sem gravar: a alteração ficava suja e sem ninguém para gravá-la, porque o
    // efeito só volta a agendar quando o valor muda de novo — e o valor não vai
    // mudar sozinho. Pior, `saveNow` reportava sucesso sem ter salvo nada.
    if (inFlightRef.current) {
      // Teto: uma requisição que nunca volta não pode virar polling eterno.
      // Estourou, a edição continua suja e a próxima digitação reagenda — mas
      // desistir CALADO seria trocar um defeito por outro: a pill continuaria
      // dizendo "Alterações não salvas" como se ainda fosse tentar. Marca erro.
      if (requeuesRef.current >= MAX_REQUEUES) {
        if (mountedRef.current) {
          setStatus("error");
          setError("O servidor não respondeu. Edite de novo para tentar.");
        }
        return false;
      }
      requeuesRef.current += 1;
      const retry = () => {
        pendingRef.current = false;
        void persistRef.current();
      };
      if (mountedRef.current) {
        if (timerRef.current) clearTimeout(timerRef.current);
        // `pendingRef` continua ligado durante o re-agendamento: sem isto,
        // desmontar nesta janela de 150ms cairia no mesmo buraco que o flush
        // de unmount tapa — só que mais estreito, e por isso mais difícil de
        // enxergar.
        pendingRef.current = true;
        timerRef.current = setTimeout(retry, 150);
      } else {
        // Já desmontado (este persist veio do flush de unmount). O timer NÃO
        // pode morar em `timerRef`: a limpeza do efeito de debounce roda depois
        // da deste efeito e limparia justamente ele, engolindo a edição que o
        // flush existe para salvar.
        orphanTimerRef.current = setTimeout(retry, 150);
      }
      return false;
    }
    requeuesRef.current = 0;

    inFlightRef.current = true;
    // O save de unmount roda com o componente já fora da árvore: o fetch vale,
    // o setState não.
    if (mountedRef.current) {
      setStatus("saving");
      setError(null);
    }
    try {
      const payload = Object.fromEntries(dirty.map((k) => [k, norm(state[k]).trim()]));
      const res = await fetch(ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        // 401/403/404 são definitivos (sem permissão, sessão expirada, recurso
        // sumiu): insistir só queima request, e sem a trava CADA tecla vira um
        // PATCH novo contra uma rota que já recusou. 400/422 são de CONTEÚDO —
        // o usuário corrige digitando, então NÃO travam; a baseline não avança
        // e a próxima edição válida reagenda sozinha.
        const definitivo =
          res.status === 401 || res.status === 403 || res.status === 404;
        if (definitivo) {
          stoppedRef.current = true;
          if (timerRef.current) clearTimeout(timerRef.current);
          toast.error(
            j.error === "PERMISSION_DENIED"
              ? "Você não tem permissão para alterar estas configurações."
              : (j.error ?? "Não foi possível salvar. Recarregue a página."),
          );
        }
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
  }, [dirtyKeys, keys, ENDPOINT]);

  // Deixa o unmount e o re-agendamento chamarem a versão corrente sem se
  // auto-referenciar.
  const persistRef = useRef(persist);
  persistRef.current = persist;

  // --- Autosave: debounce após a última tecla ---
  useEffect(() => {
    // Todo caminho que NÃO agenda precisa zerar `pendingRef`: ele é o que
    // autoriza o unmount a gravar, e deixá-lo preso em `true` faria um form
    // limpo (ou ainda não hidratado) disparar PATCH ao desmontar.
    if (!hydrated || stoppedRef.current || dirtyKeys(form).length === 0) {
      pendingRef.current = false;
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = true;
    timerRef.current = setTimeout(() => {
      pendingRef.current = false;
      void persist();
    }, debounceMs);
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

  /** Flush imediato — usar no `blur` de campo de texto. */
  const saveNow = useCallback(async (): Promise<boolean> => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = false;
    return persist();
  }, [persist]);

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
