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

  it("chave inválida NÃO segura as vizinhas válidas", async () => {
    // Achado de review no lote 4. Com `isValid` reprovando a seção inteira, um
    // CPF pela metade impedia o NOME — já corrigido e válido — de ser gravado.
    // Sem botão, o usuário não tinha como forçar; e como nada era agendado, o
    // flush de unmount também não disparava. A edição boa sumia calada.
    const spy = mockFetch(() => ({ ok: true }));
    const { rerender } = renderHook(
      ({ v }) =>
        useSettingsAutoSave(v, {
          endpoint: ENDPOINT,
          debounceMs: 10,
          invalidKeys: (f) => (f.cpf === "111" ? ["cpf"] : []),
        }),
      { initialProps: { v: { name: "Olavo", cpf: "" } } },
    );

    rerender({ v: { name: "Olavo Piton", cpf: "111" } });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const enviado = bodyOf(spy);
    expect(enviado.name).toBe("Olavo Piton");
    expect(enviado).not.toHaveProperty("cpf");

    // Save PARCIAL é o único caminho que o contador de baseline (#463) muda
    // fora da pill: só `name` avança a baseline, então `dirtySignature` passa
    // de "name=…|cpf=…" para "cpf=…" e o efeito de agendamento VOLTA a rodar,
    // onde antes ficava congelado. Ele tem de morrer no guard de `enviaveis`
    // (a única chave suja é a inválida) — sem isso, o CPF ruim viraria um
    // PATCH por ciclo contra uma rota que grava audit log a cada gravação.
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("com TUDO que mudou inválido, não sai PATCH nem ao desmontar", async () => {
    // A contraprova: o filtro não pode virar desculpa para mandar corpo vazio,
    // nem para o unmount gravar lixo.
    const spy = mockFetch(() => ({ ok: true }));
    const { rerender, unmount } = renderHook(
      ({ v }) =>
        useSettingsAutoSave(v, {
          endpoint: ENDPOINT,
          debounceMs: 5_000,
          invalidKeys: (f) => (f.cpf === "111" ? ["cpf"] : []),
        }),
      { initialProps: { v: { cpf: "" } } },
    );

    rerender({ v: { cpf: "111" } });
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it("corrigir a chave inválida faz ela viajar depois", async () => {
    const spy = mockFetch(() => ({ ok: true }));
    const { rerender } = renderHook(
      ({ v }) =>
        useSettingsAutoSave(v, {
          endpoint: ENDPOINT,
          debounceMs: 10,
          invalidKeys: (f) => (f.cpf === "111" ? ["cpf"] : []),
        }),
      { initialProps: { v: { cpf: "" } } },
    );

    rerender({ v: { cpf: "111" } });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(spy).not.toHaveBeenCalled();

    rerender({ v: { cpf: "111.444.777-35" } });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(bodyOf(spy).cpf).toBe("111.444.777-35");
  });

  it("NaN não se confunde com 'não informado' na comparação", async () => {
    // `JSON.stringify(NaN)` é "null". Sem tratamento, um campo numérico que o
    // usuário deixou inválido ficava IGUAL a vazio: a pill dizia "sem
    // alterações" enquanto o erro inline dizia o contrário.
    const spy = mockFetch(() => ({ ok: true }));
    const { result, rerender } = renderHook(
      ({ v }) =>
        useSettingsAutoSave(v, {
          endpoint: ENDPOINT,
          debounceMs: 10,
          invalidKeys: (f) =>
            Number.isNaN(f.renda as number) ? ["renda"] : [],
        }),
      { initialProps: { v: { renda: null as number | null } } },
    );

    rerender({ v: { renda: Number.NaN } });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.isDirty).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("desmontar durante o re-agendamento (PATCH em voo) também grava", async () => {
    // A mesma perda, numa janela mais estreita: com um PATCH em voo, a edição
    // nova espera num timer de 150ms. Duas coisas precisam valer aí — que
    // `pendingRef` continue ligado, e que o timer que o flush de unmount cria
    // NÃO more em `timerRef`, porque a limpeza do efeito de debounce roda
    // depois e cancelaria justamente ele.
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

    const { rerender, unmount } = renderHook(
      ({ v }) => useSettingsAutoSave(v, { endpoint: ENDPOINT, debounceMs: 10 }),
      { initialProps: { v: { prazo: 15 } } },
    );

    rerender({ v: { prazo: 20 } });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    rerender({ v: { prazo: 30 } });
    await act(async () => {
      vi.advanceTimersByTime(20);
    });
    expect(spy).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      releaseFirst?.();
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(bodyOf(spy, 1).prazo).toBe(30);
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

  // #463. A baseline é REF: mutar não invalida memo. Como `dirtyKeys` é
  // memoizado em `fields`, quem passa um `fields` de identidade ESTÁVEL (o
  // `useMemo` do /settings/profile) ficava com a sujeira congelada depois do
  // save — pill em "Alterações não salvas" para sempre, com PATCH 200 no
  // histórico. Quem passa objeto literal inline escapava por acidente.
  //
  // No `renderHook`, os props mantêm a mesma identidade nos re-renders que o
  // próprio hook provoca (setStatus/setBaselineVersao) — então este teste
  // reproduz o caso do /settings/profile, e não o do card com literal inline.
  // Naquele, o mascaramento vem do COMPONENTE recriar o objeto a cada render,
  // coisa que este harness não faz. É por isso que o bug nunca apareceu ali.
  it("save bem-sucedido limpa a sujeira mesmo com `fields` de identidade estável", async () => {
    const spy = mockFetch(() => ({ ok: true }));
    const editado = { autoLockFormOnFinalize: true };
    const { result, rerender } = renderHook(
      ({ v }) => useSettingsAutoSave(v, { endpoint: ENDPOINT, debounceMs: 10 }),
      { initialProps: { v: { autoLockFormOnFinalize: false } } },
    );

    rerender({ v: editado });
    expect(result.current.isDirty).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(spy).toHaveBeenCalledTimes(1);

    // Nenhum rerender com `fields` novo daqui pra frente — é o cenário real.
    await waitFor(() => expect(result.current.isDirty).toBe(false));

    // Amostra ao longo do tempo: o defeito só ficava visível ~3s depois, quando
    // o status "saved" expira e a pill volta a renderizar por `isDirty`.
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(result.current.isDirty).toBe(false);
    expect(result.current.status).toBe("idle");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
