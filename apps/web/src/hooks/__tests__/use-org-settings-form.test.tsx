import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useOrgSettingsForm } from "../use-org-settings-form";

/**
 * O hook que salva o cadastro da imobiliária (perfil, dados fiscais, identidade
 * visual) não tinha teste nenhum. Ganhou estes quando os três botões "Salvar"
 * que o acompanhavam foram removidos — sem o botão, cada saída do estado que o
 * debounce não cobre vira perda silenciosa, e não há mais clique que salve.
 *
 * Em ordem de gravidade:
 *
 *  1. **Unmount no meio do debounce.** `AgencyProfileForm` vive num passo do
 *     wizard de onboarding e em `/settings/perfil`: sair da página dentro da
 *     janela de 1,2s descartava o que tinha sido digitado. O wizard contornava
 *     mantendo o form montado e só escondido — prova de que doía.
 *  2. **Editar durante um PATCH em voo.** O código antigo devolvia `true` sem
 *     gravar: a chave ficava suja e sem ninguém para gravá-la, porque o efeito
 *     só reagenda quando o VALOR muda de novo.
 *  3. **Campo intocado nunca viaja** — é o que impede a tela fiscal e o perfil
 *     do onboarding, que escrevem nas MESMAS colunas, de pisarem uma na outra.
 *  4. **4xx discriminado:** 403 é veredito e trava; 400 é conteúdo e não pode
 *     congelar a seção pelo resto da sessão.
 */

type FetchSpy = ReturnType<typeof vi.fn>;

interface PatchResult {
  ok?: boolean;
  status?: number;
  json?: () => Promise<unknown>;
}

/** GET hidrata; PATCH é o que os testes observam. */
function mockApi(opts: {
  get?: Record<string, unknown>;
  patch?: () => PatchResult | Promise<PatchResult>;
}): FetchSpy {
  const spy = vi.fn(async (_url: string, init?: RequestInit) => {
    if (!init?.method || init.method === "GET") {
      return {
        ok: true,
        status: 200,
        json: async () => opts.get ?? {},
      } as Response;
    }
    const r = (await opts.patch?.()) ?? {};
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: r.json ?? (async () => ({})),
    } as Response;
  });
  global.fetch = spy as unknown as typeof fetch;
  return spy;
}

function patchCalls(spy: FetchSpy): RequestInit[] {
  return spy.mock.calls
    .map((c) => c[1] as RequestInit | undefined)
    .filter((i): i is RequestInit => i?.method === "PATCH");
}

function patchBody(spy: FetchSpy, n = 0): Record<string, unknown> {
  return JSON.parse(patchCalls(spy)[n].body as string);
}

const INITIAL = { legalName: "", cnpj: "" };

function render(debounceMs = 10) {
  return renderHook(() => useOrgSettingsForm(INITIAL, { debounceMs }));
}

describe("useOrgSettingsForm", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("montar e hidratar não dispara PATCH", async () => {
    const spy = mockApi({ get: { legalName: "Imobiliária Modelo", cnpj: "" } });
    const { result } = render();

    await waitFor(() => expect(result.current.hydrated).toBe(true));
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(patchCalls(spy)).toHaveLength(0);
    // O valor do servidor entrou no form sem virar edição do usuário.
    expect(result.current.form.legalName).toBe("Imobiliária Modelo");
  });

  it("manda só a chave suja — a intocada não viaja", async () => {
    const spy = mockApi({ get: { legalName: "Antiga", cnpj: "00.000.000/0001-00" } });
    const { result } = render();
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    act(() => result.current.set("legalName", "Nova"));
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    await waitFor(() => expect(patchCalls(spy)).toHaveLength(1));
    expect(Object.keys(patchBody(spy))).toEqual(["legalName"]);
  });

  it("string vai aparada", async () => {
    const spy = mockApi({ get: {} });
    const { result } = render();
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    act(() => result.current.set("legalName", "  Acme  "));
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    await waitFor(() => expect(patchCalls(spy)).toHaveLength(1));
    expect(patchBody(spy).legalName).toBe("Acme");
  });

  it("a hidratação não atropela o campo que já estava sendo digitado", async () => {
    const spy = mockApi({ get: { legalName: "Do servidor", cnpj: "111" } });
    const { result } = render();

    // Digita ANTES do GET voltar.
    act(() => result.current.set("legalName", "Do usuário"));
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    expect(result.current.form.legalName).toBe("Do usuário");
    expect(result.current.form.cnpj).toBe("111");
    void spy;
  });

  it("desmontar no meio do debounce GRAVA em vez de descartar", async () => {
    const spy = mockApi({ get: {} });
    const { result, unmount } = renderHook(() =>
      useOrgSettingsForm(INITIAL, { debounceMs: 5_000 }),
    );
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    act(() => result.current.set("legalName", "Digitado e não confirmado"));
    expect(patchCalls(spy)).toHaveLength(0);

    // Sai da página dentro da janela do debounce.
    unmount();
    await act(async () => {});

    await waitFor(() => expect(patchCalls(spy)).toHaveLength(1));
    expect(patchBody(spy).legalName).toBe("Digitado e não confirmado");
  });

  it("desmontar sem nada sujo não dispara PATCH", async () => {
    // A contraprova do teste acima: o flush de unmount não pode gravar por
    // conta própria uma tela que ninguém editou.
    const spy = mockApi({ get: { legalName: "Igual", cnpj: "" } });
    const { result, unmount } = renderHook(() =>
      useOrgSettingsForm(INITIAL, { debounceMs: 5_000 }),
    );
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    unmount();
    await act(async () => {});

    expect(patchCalls(spy)).toHaveLength(0);
  });

  it("editar durante um PATCH em voo não perde a segunda edição", async () => {
    let release: (() => void) | null = null;
    const spy = mockApi({
      patch: () =>
        new Promise<PatchResult>((resolve) => {
          release = () => resolve({ ok: true });
        }),
    });

    const { result } = render();
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    act(() => result.current.set("legalName", "Primeiro"));
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    await waitFor(() => expect(patchCalls(spy)).toHaveLength(1));

    // Chega uma edição enquanto o primeiro PATCH ainda não voltou.
    act(() => result.current.set("legalName", "Segundo"));
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    // Nada de novo saiu ainda — o hook re-agendou em vez de fingir sucesso.
    expect(patchCalls(spy)).toHaveLength(1);

    release?.();
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    await waitFor(() => expect(patchCalls(spy)).toHaveLength(2));
    expect(patchBody(spy, 1).legalName).toBe("Segundo");
  });

  it("desmontar durante o re-agendamento (PATCH em voo) também grava", async () => {
    // A janela estreita da mesma família: com um PATCH em voo, a edição nova
    // fica esperando num timer de 150ms. Se `pendingRef` fosse desligado aí, o
    // unmount nessa fração não teria o que gravar — o furo do debounce de
    // novo, só que mais difícil de enxergar.
    let release: (() => void) | null = null;
    const spy = mockApi({
      patch: () =>
        new Promise<PatchResult>((resolve) => {
          release ??= () => resolve({ ok: true });
        }),
    });

    const { result, unmount } = renderHook(() =>
      useOrgSettingsForm(INITIAL, { debounceMs: 10 }),
    );
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    act(() => result.current.set("legalName", "Primeiro"));
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    await waitFor(() => expect(patchCalls(spy)).toHaveLength(1));

    act(() => result.current.set("legalName", "Segundo"));
    await act(async () => {
      vi.advanceTimersByTime(20);
    });
    expect(patchCalls(spy)).toHaveLength(1);

    // Sai da página com o segundo valor ainda represado pelo re-agendamento.
    unmount();
    release?.();
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    await waitFor(() => expect(patchCalls(spy)).toHaveLength(2));
    expect(patchBody(spy, 1).legalName).toBe("Segundo");
  });

  it("requisição que nunca volta: desiste com o teto, mas AVISA", async () => {
    // O teto existe para não virar polling eterno. Desistir calado seria
    // trocar um defeito por outro: a pill seguiria em "Alterações não salvas",
    // como se ainda fosse tentar, e o usuário sairia da página confiante.
    const spy = mockApi({
      patch: () => new Promise<PatchResult>(() => {}), // nunca resolve
    });
    const { result } = render();
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    act(() => result.current.set("legalName", "Primeiro"));
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    await waitFor(() => expect(patchCalls(spy)).toHaveLength(1));

    act(() => result.current.set("legalName", "Segundo"));
    // 20 tentativas × 150ms, com folga.
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    // Nenhum PATCH novo saiu — o primeiro nunca liberou o caminho.
    expect(patchCalls(spy)).toHaveLength(1);
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.isDirty).toBe(true);
  });

  it("403 trava — sem permissão, não vira um PATCH por tecla", async () => {
    const spy = mockApi({
      patch: () => ({
        ok: false,
        status: 403,
        json: async () => ({ error: "PERMISSION_DENIED" }),
      }),
    });
    const { result } = render();
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    act(() => result.current.set("legalName", "A"));
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(patchCalls(spy)).toHaveLength(1);

    act(() => result.current.set("legalName", "AB"));
    act(() => result.current.set("legalName", "ABC"));
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(patchCalls(spy)).toHaveLength(1);
  });

  it("400 NÃO trava — corrigir o valor volta a salvar", async () => {
    let attempt = 0;
    const spy = mockApi({
      patch: () => {
        attempt += 1;
        return attempt === 1
          ? { ok: false, status: 400, json: async () => ({ error: "CNPJ inválido" }) }
          : { ok: true };
      },
    });
    const { result } = render();
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    act(() => result.current.set("cnpj", "123"));
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(patchCalls(spy)).toHaveLength(1);

    act(() => result.current.set("cnpj", "00.000.000/0001-00"));
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(patchCalls(spy)).toHaveLength(2);
    expect(patchBody(spy, 1).cnpj).toBe("00.000.000/0001-00");
  });

  it("saveNow grava na hora, sem esperar o debounce", async () => {
    const spy = mockApi({ get: {} });
    const { result } = renderHook(() =>
      useOrgSettingsForm(INITIAL, { debounceMs: 10_000 }),
    );
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    act(() => result.current.set("legalName", "Agora"));
    await act(async () => {
      await result.current.saveNow();
    });

    expect(patchCalls(spy)).toHaveLength(1);
    expect(patchBody(spy).legalName).toBe("Agora");
  });
});
