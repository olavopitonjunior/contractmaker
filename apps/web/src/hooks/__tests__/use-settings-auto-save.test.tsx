import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSettingsAutoSave } from "../use-settings-auto-save";

/**
 * O que estes testes protegem, em ordem de gravidade:
 *
 *  1. Booleano precisa chegar ao servidor como booleano. O hook de texto
 *     (`use-org-settings-form`) coage tudo a string, e o `z.boolean()` da rota
 *     rejeita `"true"` — era por isso que os toggles não podiam usar auto-save.
 *  2. Só a chave suja viaja. O save monolítico da tela reenviava os presets e
 *     os paths customizados junto; um path órfão derrubava o PATCH inteiro com
 *     400 e levava o toggle junto.
 *  3. 4xx tem que TRAVAR. Sem a trava, um membro sem permissão gera um PATCH
 *     por tecla contra uma rota que já respondeu 403.
 *  4. Seção inválida não pode ser gravada — auto-save ingênuo persiste o estado
 *     intermediário da digitação.
 */

type FetchSpy = ReturnType<typeof vi.fn>;

function mockFetch(
  impl: () => { ok?: boolean; status?: number; json?: () => Promise<unknown> },
): FetchSpy {
  const spy = vi.fn(async (_url: string, init?: RequestInit) => {
    const res = impl();
    void init;
    return {
      ok: res.ok ?? true,
      status: res.status ?? 200,
      json: res.json ?? (async () => ({})),
    } as Response;
  });
  global.fetch = spy as unknown as typeof fetch;
  return spy;
}

function bodyOf(spy: FetchSpy, call = 0): Record<string, unknown> {
  return JSON.parse((spy.mock.calls[call][1] as RequestInit).body as string);
}

const ENDPOINT = "/api/org/form-settings";

describe("useSettingsAutoSave", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("montar com o valor do servidor não dispara PATCH", async () => {
    const spy = mockFetch(() => ({ ok: true }));
    renderHook(() =>
      useSettingsAutoSave(
        { autoLockFormOnFinalize: false },
        { endpoint: ENDPOINT, debounceMs: 10 },
      ),
    );
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("boolean vai como boolean, não como string", async () => {
    const spy = mockFetch(() => ({ ok: true }));
    const { rerender } = renderHook(
      ({ v }) => useSettingsAutoSave(v, { endpoint: ENDPOINT, debounceMs: 10 }),
      { initialProps: { v: { autoLockFormOnFinalize: false } } },
    );

    rerender({ v: { autoLockFormOnFinalize: true } });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const sent = bodyOf(spy);
    expect(sent.autoLockFormOnFinalize).toBe(true);
    expect(sent.autoLockFormOnFinalize).not.toBe("true");
  });

  it("manda só a chave suja — a intocada não viaja", async () => {
    const spy = mockFetch(() => ({ ok: true }));
    const { rerender } = renderHook(
      ({ v }) => useSettingsAutoSave(v, { endpoint: ENDPOINT, debounceMs: 10 }),
      {
        initialProps: {
          v: {
            autoLockFormOnFinalize: false,
            requireCommissionerReceiving: false,
            // As chaves que derrubavam o PATCH inteiro quando havia path órfão.
            preset: "essencial",
            customRequiredPaths: [] as unknown[],
          },
        },
      },
    );

    rerender({
      v: {
        autoLockFormOnFinalize: true,
        requireCommissionerReceiving: false,
        preset: "essencial",
        customRequiredPaths: [],
      },
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(Object.keys(bodyOf(spy))).toEqual(["autoLockFormOnFinalize"]);
  });

  it("objeto aninhado é comparado estruturalmente (não vira [object Object])", async () => {
    const spy = mockFetch(() => ({ ok: true }));
    const { rerender } = renderHook(
      ({ v }) => useSettingsAutoSave(v, { endpoint: ENDPOINT, debounceMs: 10 }),
      {
        initialProps: {
          v: { contractDefaults: { venda: { foro: "arbitragem" } } },
        },
      },
    );

    rerender({
      v: { contractDefaults: { venda: { foro: "justica-publica" } } },
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(bodyOf(spy)).toEqual({
      contractDefaults: { venda: { foro: "justica-publica" } },
    });
  });

  it("edições seguidas colapsam num PATCH só", async () => {
    const spy = mockFetch(() => ({ ok: true }));
    const { rerender } = renderHook(
      ({ v }) => useSettingsAutoSave(v, { endpoint: ENDPOINT, debounceMs: 50 }),
      { initialProps: { v: { summaryRecipientEmail: "" } } },
    );

    rerender({ v: { summaryRecipientEmail: "a@" } });
    rerender({ v: { summaryRecipientEmail: "a@b" } });
    rerender({ v: { summaryRecipientEmail: "a@b.com" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(bodyOf(spy).summaryRecipientEmail).toBe("a@b.com");
  });

  it("estado inválido não é gravado, e grava sozinho quando fica válido", async () => {
    const spy = mockFetch(() => ({ ok: true }));
    const isValid = (f: { summaryRecipientEmail: string }) =>
      f.summaryRecipientEmail === "" || f.summaryRecipientEmail.includes("@");

    const { result, rerender } = renderHook(
      ({ v }) =>
        useSettingsAutoSave(v, { endpoint: ENDPOINT, isValid, debounceMs: 10 }),
      { initialProps: { v: { summaryRecipientEmail: "" } } },
    );

    rerender({ v: { summaryRecipientEmail: "invalido" } });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(spy).not.toHaveBeenCalled();
    expect(result.current.isDirty).toBe(true);

    rerender({ v: { summaryRecipientEmail: "valido@x.com" } });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(bodyOf(spy).summaryRecipientEmail).toBe("valido@x.com");
  });

  it("4xx trava: tecla nova NÃO gera request novo", async () => {
    const spy = mockFetch(() => ({
      ok: false,
      status: 403,
      json: async () => ({ error: "PERMISSION_DENIED" }),
    }));
    const { result, rerender } = renderHook(
      ({ v }) => useSettingsAutoSave(v, { endpoint: ENDPOINT, debounceMs: 10 }),
      { initialProps: { v: { requireCommissionerReceiving: false } } },
    );

    rerender({ v: { requireCommissionerReceiving: true } });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("PERMISSION_DENIED");
    expect(spy).toHaveBeenCalledTimes(1);

    rerender({ v: { requireCommissionerReceiving: false } });
    rerender({ v: { requireCommissionerReceiving: true } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("400 de validação NÃO trava — corrigir o valor volta a salvar", async () => {
    // Regressão: tratar todo 4xx como veredito final deixava o auto-save PIOR
    // que o botão que ele substituiu. Um prazo momentaneamente fora de faixa
    // (apagar "15" para digitar "20") tomava 400 e congelava a seção inteira
    // pelo resto da sessão — nem corrigir o número destravava.
    let attempt = 0;
    const spy = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: "Body inválido" }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });
    global.fetch = spy as unknown as typeof fetch;

    const { result, rerender } = renderHook(
      ({ v }) => useSettingsAutoSave(v, { endpoint: ENDPOINT, debounceMs: 10 }),
      { initialProps: { v: { prazo: 15 } } },
    );

    rerender({ v: { prazo: 0 } });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(spy).toHaveBeenCalledTimes(1);

    rerender({ v: { prazo: 20 } });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(bodyOf(spy, 1).prazo).toBe(20);
  });

  it("403 trava de vez — é permissão, não conteúdo", async () => {
    const spy = mockFetch(() => ({
      ok: false,
      status: 403,
      json: async () => ({ error: "PERMISSION_DENIED" }),
    }));
    const { result, rerender } = renderHook(
      ({ v }) => useSettingsAutoSave(v, { endpoint: ENDPOINT, debounceMs: 10 }),
      { initialProps: { v: { prazo: 15 } } },
    );

    rerender({ v: { prazo: 20 } });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await waitFor(() => expect(result.current.status).toBe("error"));

    rerender({ v: { prazo: 30 } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("erro de rede NÃO trava — a próxima edição tenta de novo", async () => {
    let attempt = 0;
    const spy = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("network");
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });
    global.fetch = spy as unknown as typeof fetch;

    const { result, rerender } = renderHook(
      ({ v }) => useSettingsAutoSave(v, { endpoint: ENDPOINT, debounceMs: 10 }),
      { initialProps: { v: { summaryIncludeAttachments: true } } },
    );

    rerender({ v: { summaryIncludeAttachments: false } });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(spy).toHaveBeenCalledTimes(1);

    // A baseline NÃO avançou no erro, então a chave segue suja: uma edição
    // nova reagenda e o valor corrente é gravado.
    rerender({ v: { summaryIncludeAttachments: true } });
    rerender({ v: { summaryIncludeAttachments: false } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("voltar ao valor já salvo não gera PATCH", async () => {
    const spy = mockFetch(() => ({ ok: true }));
    const { rerender } = renderHook(
      ({ v }) => useSettingsAutoSave(v, { endpoint: ENDPOINT, debounceMs: 10 }),
      { initialProps: { v: { autoLockFormOnFinalize: false } } },
    );

    rerender({ v: { autoLockFormOnFinalize: true } });
    rerender({ v: { autoLockFormOnFinalize: false } });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("flush grava na hora, sem esperar o debounce", async () => {
    const spy = mockFetch(() => ({ ok: true }));
    const { result, rerender } = renderHook(
      ({ v }) =>
        useSettingsAutoSave(v, { endpoint: ENDPOINT, debounceMs: 10_000 }),
      { initialProps: { v: { summaryRecipientEmail: "" } } },
    );

    rerender({ v: { summaryRecipientEmail: "a@b.com" } });
    await act(async () => {
      await result.current.flush();
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(bodyOf(spy).summaryRecipientEmail).toBe("a@b.com");
  });

  it("mexer durante um PATCH em voo não perde a alteração", async () => {
    // O primeiro PATCH fica pendurado; o segundo valor chega enquanto ele
    // ainda está em voo. Sem re-agendamento, essa alteração ficaria suja e sem
    // ninguém para gravá-la — o efeito só dispara quando o valor muda, e ele
    // não muda sozinho. Seria a mesma perda silenciosa que estamos corrigindo.
    let releaseFirst: (() => void) | null = null;
    let calls = 0;
    const spy = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });
    global.fetch = spy as unknown as typeof fetch;

    const { rerender } = renderHook(
      ({ v }) => useSettingsAutoSave(v, { endpoint: ENDPOINT, debounceMs: 10 }),
      { initialProps: { v: { summaryRecipientEmail: "" } } },
    );

    rerender({ v: { summaryRecipientEmail: "a@b.com" } });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    // Chega uma alteração nova com o primeiro PATCH ainda aberto.
    rerender({ v: { summaryRecipientEmail: "c@d.com" } });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    await act(async () => {
      releaseFirst?.();
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(bodyOf(spy, 1).summaryRecipientEmail).toBe("c@d.com");
  });

  it("desmontar no meio do debounce GRAVA, não descarta", async () => {
    // Regressão de produção (fase 1): o cleanup só fazia clearTimeout, então
    // digitar um valor no Padrão contratual e trocar a aba Vendas↔Locação
    // dentro da janela de debounce perdia a edição em silêncio — e sem o botão
    // "Salvar", nada dava ao usuário a chance de perceber. Trocar de aba é o
    // caminho comum, não o exótico: `ContractDefaultsCard` renderiza
    // `esteira === "venda" ? <VendaDefaults/> : <LocacaoDefaults/>`, ou seja,
    // desmonta o formulário inteiro.
    const spy = mockFetch(() => ({ ok: true }));
    const { rerender, unmount } = renderHook(
      ({ v }) =>
        useSettingsAutoSave(v, { endpoint: ENDPOINT, debounceMs: 5_000 }),
      { initialProps: { v: { prazo: 15 } } },
    );

    rerender({ v: { prazo: 20 } });
    // Desmonta ANTES do debounce vencer.
    unmount();

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(bodyOf(spy).prazo).toBe(20);
  });

  it("desmontar sem nada pendente não dispara PATCH", async () => {
    const spy = mockFetch(() => ({ ok: true }));
    const { unmount } = renderHook(() =>
      useSettingsAutoSave(
        { prazo: 15 },
        { endpoint: ENDPOINT, debounceMs: 10 },
      ),
    );

    unmount();
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("desmontar com estado inválido não grava lixo", async () => {
    const spy = mockFetch(() => ({ ok: true }));
    const isValid = (f: { email: string }) =>
      f.email === "" || f.email.includes("@");
    const { rerender, unmount } = renderHook(
      ({ v }) =>
        useSettingsAutoSave(v, {
          endpoint: ENDPOINT,
          isValid,
          debounceMs: 5_000,
        }),
      { initialProps: { v: { email: "" } } },
    );

    rerender({ v: { email: "invalido" } });
    unmount();

    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("alwaysInclude entra em todo PATCH, mesmo sem ter mudado", async () => {
    // Regressão: `kind` é constante na instância do editor de SLA (o pai
    // remonta por `key={kind}`), então NUNCA fica sujo e o diff por chave nunca
    // o incluiria — mas o schema da rota é `.strict()` e o exige. Sem isto,
    // todo save de SLA voltava 400 "Body inválido".
    const spy = mockFetch(() => ({ ok: true }));
    const { rerender } = renderHook(
      ({ v }) =>
        useSettingsAutoSave(v, {
          endpoint: ENDPOINT,
          alwaysInclude: { kind: "venda" },
          debounceMs: 10,
        }),
      { initialProps: { v: { policies: [] as unknown[] } } },
    );

    rerender({ v: { policies: [{ stageId: "s1", warnDays: 5 }] } });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const sent = bodyOf(spy);
    expect(sent.kind).toBe("venda");
    expect(sent.policies).toEqual([{ stageId: "s1", warnDays: 5 }]);
  });

  it("alwaysInclude sozinho NÃO dispara save", async () => {
    const spy = mockFetch(() => ({ ok: true }));
    renderHook(() =>
      useSettingsAutoSave(
        { policies: [] as unknown[] },
        {
          endpoint: ENDPOINT,
          alwaysInclude: { kind: "venda" },
          debounceMs: 10,
        },
      ),
    );
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("buildPayload: observa por item, envia só o que mudou", async () => {
    // Substitui um teste anterior que passava por acidente: ele rerenderizava
    // com o MESMO valor já salvo, o que o hook sempre suprimiu — não exercitava
    // o ciclo salvar → refresh → reavaliar, que era onde o bug vivia.
    //
    // Aqui a forma observada (uma chave por item) é diferente da forma enviada
    // (a lista que a rota espera), e o teste prova as duas coisas que a versão
    // "manda tudo" quebrava: só o item alterado viaja, e depois do save nada
    // é reagendado.
    const spy = mockFetch(() => ({ ok: true }));
    const buildPayload = (sujos: Record<string, unknown>) => ({
      policies: Object.entries(sujos).map(([k, v]) => ({
        stageId: k.replace(/^policy_/, ""),
        ...(v as Record<string, unknown>),
      })),
    });

    const { rerender } = renderHook(
      ({ v }) =>
        useSettingsAutoSave(v, {
          endpoint: ENDPOINT,
          alwaysInclude: { kind: "venda" },
          buildPayload,
          debounceMs: 10,
        }),
      {
        initialProps: {
          v: {
            policy_s1: { warnDays: "5" },
            policy_s2: { warnDays: "5" },
            policy_s3: { warnDays: "5" },
          },
        },
      },
    );

    // Mexe só em s2.
    rerender({
      v: {
        policy_s1: { warnDays: "5" },
        policy_s2: { warnDays: "9" },
        policy_s3: { warnDays: "5" },
      },
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    const body = bodyOf(spy);
    expect(body.kind).toBe("venda");
    // A etapa intocada NÃO pode viajar: a rota grava por stageId o que recebe,
    // e reescrever s1/s3 os tornaria "personalizado" para sempre, além de
    // ressuscitar valores default por cima dos reais.
    expect(body.policies).toEqual([{ stageId: "s2", warnDays: "9" }]);

    // Depois do save o valor observado continua o mesmo (o draft já bate com o
    // que o servidor gravou): nada é reagendado, nenhum PATCH vazio.
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("enabled:false zera o pendente — unmount não grava depois", async () => {
    // Sem zerar `pendingRef` nos caminhos que não agendam, uma seção que
    // perdeu permissão (enabled → false) ainda dispararia PATCH ao desmontar,
    // porque `persist` não checa `enabled`.
    const spy = mockFetch(() => ({ ok: true }));
    const { rerender, unmount } = renderHook(
      ({ v, on }) =>
        useSettingsAutoSave(v, {
          endpoint: ENDPOINT,
          enabled: on,
          debounceMs: 5_000,
        }),
      { initialProps: { v: { prazo: 15 }, on: true } },
    );

    rerender({ v: { prazo: 20 }, on: true });
    rerender({ v: { prazo: 20 }, on: false });
    unmount();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("enabled:false não agenda nada", async () => {
    const spy = mockFetch(() => ({ ok: true }));
    const { rerender } = renderHook(
      ({ v }) =>
        useSettingsAutoSave(v, {
          endpoint: ENDPOINT,
          debounceMs: 10,
          enabled: false,
        }),
      { initialProps: { v: { autoLockFormOnFinalize: false } } },
    );

    rerender({ v: { autoLockFormOnFinalize: true } });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
