"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

export type SettingsSaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Chaves top-level do corpo do PATCH. O valor é livre — boolean, número, string,
 * array ou objeto aninhado (`contractDefaults`, `participantVisibility`).
 */
export type SettingsFields = Record<string, unknown>;

export interface UseSettingsAutoSaveOptions<T extends SettingsFields> {
  /** Rota do PATCH. Ex.: `/api/org/form-settings`. */
  endpoint: string;
  /**
   * Guarda de coerência da seção. Enquanto devolver false, nenhum PATCH sai: o
   * status fica pendente e volta a agendar sozinho quando o conjunto ficar
   * válido. É o que substitui o `disabled={invalid}` que antes morava no botão.
   *
   * Sem isto o auto-save grava o estado intermediário da digitação — em
   * `pagamentos/taxas` isso significa persistir multa "15" a caminho de "1,5",
   * furando o teto legal do art. 52 do CDC.
   */
  isValid?: (fields: T) => boolean;
  debounceMs?: number;
  /**
   * Chaves que entram em TODO PATCH, mesmo sem terem mudado.
   *
   * Existe para o campo que é constante na instância mas **obrigatório** no
   * schema da rota — o caso do `kind` em `/api/org/sla-policies`, que é
   * `.strict()` e exige `kind` junto das políticas. Sem isto, o diff por chave
   * suja nunca o incluiria (ele nasce igual à baseline e nunca muda) e todo
   * save voltaria 400 por corpo inválido.
   *
   * Não conta para o dirty: sozinho, não dispara nada.
   */
  alwaysInclude?: Record<string, unknown>;
  /**
   * Separa O QUE É COMPARADO do QUE É ENVIADO.
   *
   * Por padrão o corpo do PATCH são as próprias chaves sujas. Isso só funciona
   * quando a forma do estado coincide com a forma que a rota espera. Quando não
   * coincide, observe o estado numa forma **estável** (uma chave por item) e
   * use isto para montar o corpo a partir de `sujos`.
   *
   * O SLA é o caso: a rota quer `{ kind, policies: [...] }`. Observar a lista
   * de etapas alteradas parecia natural, mas ela ESVAZIA depois de salvar — e
   * `[]` difere da baseline, o que disparava um segundo PATCH vazio. Observar a
   * lista COMPLETA consertava isso e criava algo pior: como a rota grava por
   * `stageId` tudo que recebe, toda gravação reescrevia também as etapas
   * intocadas, transformando "padrão" em "personalizado" para sempre e
   * ressuscitando 5/10 por cima dos valores reais de etapas desligadas.
   *
   * Com uma chave por etapa cada baseline converge sozinha depois do save, e
   * `buildPayload` manda no corpo só as etapas que mudaram de fato.
   */
  buildPayload?: (dirtyFields: Partial<T>, allFields: T) => Record<string, unknown>;
  /** Desliga o agendamento (seção somente-leitura / sem permissão). */
  enabled?: boolean;
  /**
   * Roda depois de um PATCH bem-sucedido, com o corpo que foi enviado. Serve
   * para o card reconciliar o próprio estado com o que acabou de ser gravado —
   * é assim que os campos de categoria congelam a `key` derivada do rótulo,
   * para que digitar mais não renomeie um identificador já persistido.
   */
  onSaved?: (payload: Record<string, unknown>) => void;
}

function serialize(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/**
 * Auto-save de UMA seção de configurações.
 *
 * O card continua dono do próprio `useState`; o hook observa as chaves que a
 * seção grava, espera a digitação parar e manda **só o que mudou**.
 *
 * ## Por que diff por chave, e não o payload inteiro
 *
 * É o mesmo princípio de `useOrgSettingsForm` (que faz isso para campos de
 * texto), generalizado para valores não-string. Sem ele, salvar o toggle de
 * "Segurança do link" reenviava `preset`, `customRequiredPaths`,
 * `locacaoPreset` e `locacaoCustomRequiredPaths` no mesmo corpo — e um único
 * path órfão (campo renomeado) fazia o `.refine(isKnown)` da rota reprovar o
 * PATCH INTEIRO com 400, derrubando junto o toggle que nada tinha a ver com
 * isso. Chave não enviada é chave não tocada: o PATCH da rota é parcial.
 *
 * ## Lições herdadas de `use-auto-save.ts`, que já as pagou em produção
 *
 *  - **baseline serializada**: não reenvia valor idêntico ao que o servidor já
 *    tem; voltar um toggle ao estado original vira no-op, não outro PATCH.
 *  - **`stoppedRef`**: 4xx é veredito, não falha transitória. Um membro sem
 *    `ORG_SETTINGS_EDIT` toma 403 em toda tentativa; sem a trava, a baseline
 *    nunca avança e CADA tecla vira request novo contra uma rota que já
 *    recusou. Erro de REDE não trava — esse é transitório, a próxima edição
 *    reagenda.
 *  - **`mountedRef`**: nada de setState depois do unmount.
 */
export function useSettingsAutoSave<T extends SettingsFields>(
  fields: T,
  options: UseSettingsAutoSaveOptions<T>,
) {
  const {
    endpoint,
    isValid,
    debounceMs = 800,
    enabled = true,
    onSaved,
    alwaysInclude,
    buildPayload,
  } = options;

  const [status, setStatus] = useState<SettingsSaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  /** Sobe a cada `resync` para o memo do dirty reavaliar a baseline nova. */
  const [baselineVersao, setBaselineVersao] = useState(0);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const stoppedRef = useRef(false);
  const inFlightRef = useRef(false);
  /**
   * Há uma gravação agendada e ainda não disparada. Existe só para o unmount
   * saber que precisa gravar antes de sumir — ver o cleanup abaixo.
   */
  const pendingRef = useRef(false);

  // Verdade do servidor, por chave. Nasce do valor inicial — que a page RSC leu
  // do banco —, logo montar a tela não dispara save nenhum.
  const baselineRef = useRef<Record<string, string>>(
    Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, serialize(v)]),
    ),
  );

  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const validRef = useRef(isValid);
  validRef.current = isValid;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const buildPayloadRef = useRef(buildPayload);
  buildPayloadRef.current = buildPayload;
  const alwaysIncludeRef = useRef(alwaysInclude);
  alwaysIncludeRef.current = alwaysInclude;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      // Desmontar no meio do debounce NÃO pode descartar a edição. Este é o
      // caminho comum, não o exótico: em `ContractDefaultsCard` trocar a aba
      // Vendas↔Locação desmonta o formulário inteiro, então digitar um valor e
      // trocar de aba dentro da janela de debounce perdia o que foi digitado —
      // em silêncio, e sem o botão "Salvar" que antes dava a chance de notar.
      // O fetch sobrevive ao unmount; só os setState é que não podem rodar,
      // e `mountedRef` já cuida disso.
      if (pendingRef.current) {
        pendingRef.current = false;
        void persistRef.current();
      }
    };
  }, []);

  // Gatilho do efeito e base do `isDirty` da pill.
  const dirtyKeys = useMemo(
    () =>
      Object.keys(fields).filter(
        (k) => serialize(fields[k]) !== baselineRef.current[k],
      ),
    // `baselineVersao` entra aqui porque a baseline vive numa ref: quando o
    // `resync` a reescreve, nada mais avisaria este memo, e a pill continuaria
    // dizendo "Alterações não salvas" sobre um estado que já é o do servidor.
    // O lint a chama de desnecessária porque não a vê sendo lida no corpo — ela
    // é exatamente isso: um sinal de invalidação, não um valor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fields, baselineVersao],
  );
  // Inclui o VALOR, não só o nome da chave. Com a lista de chaves apenas, um
  // campo que continua sujo mas mudou de conteúdo não re-agendava o save — era
  // o caso do e-mail corrigido de inválido para válido: a chave suja seguia
  // sendo a mesma, o efeito não re-executava e o valor bom nunca era gravado.
  const dirtySignature = useMemo(
    () => dirtyKeys.map((k) => `${k}=${serialize(fields[k])}`).join("|"),
    [dirtyKeys, fields],
  );

  const persist = useCallback(async (): Promise<boolean> => {
    const current = fieldsRef.current;
    const dirty = Object.keys(current).filter(
      (k) => serialize(current[k]) !== baselineRef.current[k],
    );
    if (dirty.length === 0) return true;
    if (stoppedRef.current) return false;
    if (validRef.current && !validRef.current(current)) return false;
    // Editar durante um PATCH em voo não pode sumir: sem este re-agendamento,
    // a alteração ficaria suja e sem ninguém para gravá-la — o efeito só
    // dispara de novo quando o VALOR muda, e ele não vai mudar sozinho.
    if (inFlightRef.current) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void persistRef.current(), 150);
      return false;
    }

    const sujos = Object.fromEntries(
      dirty.map((k) => [k, current[k]]),
    ) as Partial<T>;
    const payload = {
      ...(alwaysIncludeRef.current ?? {}),
      ...(buildPayloadRef.current
        ? buildPayloadRef.current(sujos, current)
        : sujos),
    };

    inFlightRef.current = true;
    // O save de unmount roda com o componente já fora da árvore: o fetch vale,
    // o setState não.
    if (mountedRef.current) {
      setStatus("saving");
      setError(null);
    }
    try {
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        // Nem todo 4xx é a mesma coisa, e tratar todos como veredito final era
        // pior que o botão que substituímos:
        //
        //  - 401/403/404 são definitivos (sem `ORG_SETTINGS_EDIT`, sessão
        //    expirada, recurso sumiu). Insistir só queima request — e sem a
        //    trava CADA tecla vira um PATCH novo contra uma rota que já
        //    recusou. Aqui trava e avisa em toast, porque a única saída é
        //    recarregar ou pedir permissão.
        //  - 400/422 são de CONTEÚDO e o usuário corrige digitando. Travar
        //    aqui congelaria a seção inteira pelo resto da sessão por causa de
        //    um número momentaneamente fora de faixa. Não trava: a baseline não
        //    avança, então a próxima edição válida reagenda sozinha. Sem risco
        //    de loop, porque o efeito só dispara quando o valor muda.
        const definitivo = res.status === 401 || res.status === 403 || res.status === 404;
        if (definitivo) {
          stoppedRef.current = true;
          if (timerRef.current) clearTimeout(timerRef.current);
          toast.error(
            body.error === "PERMISSION_DENIED"
              ? "Você não tem permissão para alterar estas configurações."
              : (body.error ?? "Não foi possível salvar. Recarregue a página."),
          );
        }
        if (mountedRef.current) {
          setStatus("error");
          setError(body.error ?? "Não foi possível salvar");
        }
        return false;
      }

      for (const k of dirty) baselineRef.current[k] = serialize(current[k]);
      onSavedRef.current?.(payload);
      if (!mountedRef.current) return true;
      setStatus("saved");
      setTimeout(() => {
        if (mountedRef.current) {
          setStatus((s) => (s === "saved" ? "idle" : s));
        }
      }, 2500);
      return true;
    } catch {
      // Rede: transitório. NÃO trava — a próxima edição reagenda.
      if (mountedRef.current) {
        setStatus("error");
        setError("Erro de rede ao salvar");
      }
      return false;
    } finally {
      inFlightRef.current = false;
    }
  }, [endpoint]);

  // Deixa o re-agendamento acima chamar a versão corrente sem se auto-referenciar.
  const persistRef = useRef(persist);
  persistRef.current = persist;

  useEffect(() => {
    // Todo caminho que NÃO agenda precisa zerar `pendingRef`: ele é o que
    // autoriza o unmount a gravar, e deixá-lo preso em `true` faria uma seção
    // já desabilitada (ou inválida) disparar um PATCH ao desmontar.
    if (!enabled || stoppedRef.current) {
      pendingRef.current = false;
      return;
    }
    if (dirtySignature === "") {
      pendingRef.current = false;
      return;
    }
    // Seção incoerente: fica pendente e NÃO agenda. Volta a agendar sozinho
    // assim que a próxima edição tornar o conjunto válido.
    if (validRef.current && !validRef.current(fieldsRef.current)) {
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
  }, [dirtySignature, enabled, debounceMs, persist]);

  /** Flush imediato — usar no `blur` de campo de texto. */
  const flush = useCallback(async (): Promise<boolean> => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = false;
    return persist();
  }, [persist]);

  /**
   * Declara que os valores atuais JÁ são o que o servidor tem, sem mandar nada.
   *
   * Serve para a mutação que acontece POR FORA do auto-save e muda o mesmo
   * estado — no SLA é o botão "Restaurar padrão", que faz um DELETE direto e
   * reseta o draft para o default. Sem isto o hook enxerga aquele reset como
   * uma edição do usuário e, 800ms depois, manda um PATCH que **recria a linha
   * que o DELETE acabou de apagar** — desfazendo o restore em silêncio e
   * deixando a etapa presa em "personalizado" com os valores do default.
   *
   * Cancela também o que estiver agendado: o que veio do servidor vence.
   */
  const resync = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = false;
    const current = fieldsRef.current;
    for (const k of Object.keys(current)) {
      baselineRef.current[k] = serialize(current[k]);
    }
    setBaselineVersao((v) => v + 1);
    setStatus((s) => (s === "saving" ? s : "idle"));
  }, []);

  return { status, error, isDirty: dirtyKeys.length > 0, flush, resync };
}
