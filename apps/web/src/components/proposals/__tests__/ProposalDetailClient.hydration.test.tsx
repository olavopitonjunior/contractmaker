/**
 * Teste de HIDRATAÇÃO REAL da página de proposta.
 *
 * Não é um teste de render: faz o passo do servidor (`renderToString`), joga o
 * HTML num container e roda `hydrateRoot` por cima — exatamente o que o browser
 * faz com o HTML que a Vercel entrega. Qualquer divergência entre as duas
 * árvores aparece como `onRecoverableError` (o #418/#423 minificado em produção)
 * ou como `console.error` do React em dev, e o teste falha apontando o nó.
 *
 * Motivo de existir: o mismatch desta página só aparecia no smoke em produção.
 * Um teste de render normal (só client) nunca pega, porque não há passo de
 * servidor pra discordar.
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";

const routerMock = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
};

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  usePathname: () => "/pipeline/propostas/prop-1",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { ProposalDetailClient } from "../ProposalDetailClient";

/**
 * Props idênticas às que `app/(dashboard)/pipeline/propostas/[id]/page.tsx`
 * serializa — inclusive as datas JÁ FORMATADAS (é assim que chegam depois do
 * fix de formatação no servidor). Cenário do smoke: rascunho de locação, 1
 * signatário, histórico vazio.
 */
function draftProps() {
  return {
    proposal: {
      id: "prop-1",
      title: "Proposta de locação — Rua das Acácias, 120",
      status: "rascunho",
      kind: "locacao",
      instrument: "envelope",
      createdAtLabel: "30/07/2026 17:23",
      sentAtLabel: "—",
      deliveredAtLabel: "—",
      firstViewedAtLabel: "—",
      viewCount: 0,
      lastReminderAtLabel: "—",
      reminderCount: 0,
      validUntilLabel: "04/08/2026 17:23",
      prazo: { label: "faltam 5d", danger: false },
      convertedDealId: null,
      dossierUrl: null,
      resumo: {
        proponente: "Maria Silva",
        imovel: "Rua das Acácias, 120",
        valorLabel: "R$ 3.500",
      },
      responsible: { name: "Olavo Piton", isNonUser: false, image: null },
      responsibleUserId: "user-1",
      responsibleName: null,
    },
    signers: [
      {
        id: "sig-1",
        name: "Maria Silva",
        role: "Proponente",
        channel: "email",
        status: "",
      },
    ],
    events: [] as { id: string; eventName: string; receivedAtLabel: string }[],
    attachments: [] as {
      id: string;
      filename: string;
      category: string | null;
      url: string;
    }[],
    members: [{ id: "user-1", name: "Olavo Piton" }],
    permissions: {
      send: true,
      convert: true,
      cancel: true,
      delete: true,
      resend: true,
      assign: true,
    },
    sentSnapshotHtml: null,
  };
}

/** Variante "enviada": tem snapshot (iframe no primeiro paint) e histórico. */
function sentProps() {
  const p = draftProps();
  return {
    ...p,
    proposal: {
      ...p.proposal,
      status: "enviada",
      sentAtLabel: "30/07/2026 17:30",
      deliveredAtLabel: "30/07/2026 17:31",
      firstViewedAtLabel: "30/07/2026 18:02",
      viewCount: 3,
      reminderCount: 2,
      lastReminderAtLabel: "31/07/2026 09:00",
      prazo: { label: "faltam 2d", danger: false },
    },
    signers: [
      { id: "sig-1", name: "Maria Silva", role: "Proponente", channel: "email", status: "viewed" },
      { id: "sig-2", name: "Imobiliária X", role: "Corretora", channel: "whatsapp", status: "signed" },
    ],
    events: [
      { id: "ev-1", eventName: "sign", receivedAtLabel: "30/07/2026 18:05" },
      { id: "ev-2", eventName: "view", receivedAtLabel: "30/07/2026 18:02" },
    ],
    attachments: [
      { id: "att-1", filename: "matricula.pdf", category: "matricula", url: "https://x/y.pdf" },
    ],
    sentSnapshotHtml: "<h1>Proposta</h1><p>Conteúdo congelado no envio.</p>",
  };
}

interface HydrationReport {
  recoverable: string[];
  consoleErrors: string[];
}

/** Executa `fn` com `window`/`document` fora do escopo global, como no servidor. */
function withoutDom<T>(fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const saved = {
    window: g.window,
    document: g.document,
    navigator: g.navigator,
  };
  delete g.window;
  delete g.document;
  delete g.navigator;
  try {
    return fn();
  } finally {
    Object.assign(g, saved);
  }
}

/**
 * Roda o ciclo servidor→cliente e devolve TODO mismatch observado.
 *
 * `onRecoverableError` é o canal em que o React 18 entrega o #418/#423. O
 * `console.error` complementa: em dev o React descreve o nó exato ("Warning:
 * Text content did not match. Server: ... Client: ...") antes de tentar a
 * recuperação, e é essa mensagem que aponta o culpado.
 */
async function hydrateAndCollect(element: React.ReactElement): Promise<HydrationReport> {
  const recoverable: string[] = [];
  const consoleErrors: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    consoleErrors.push(args.map((a) => String(a)).join(" "));
  };

  let container: HTMLDivElement | null = null;
  try {
    // O passo do servidor entra na captura junto: avisos que o React emite AQUI
    // (ex.: `useLayoutEffect` num componente que só existe no client) são a causa
    // de mismatch, e ficariam invisíveis se só olhássemos a hidratação.
    //
    // E roda SEM `window`/`document`: no runtime da Vercel eles não existem, e
    // meia biblioteca de UI decide o que renderizar com `typeof window` ou
    // `globalThis?.document?.body` (Radix Portal é assim). Com o DOM do happy-dom
    // visível durante o render do servidor, o teste produziria o HTML do CLIENT
    // nos dois lados e nunca veria a diferença que a produção vê.
    const serverHtml = withoutDom(() => renderToString(element));

    container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.appendChild(container);

    await act(async () => {
      hydrateRoot(container!, element, {
        onRecoverableError: (err) => {
          recoverable.push(err instanceof Error ? err.message : String(err));
        },
      });
    });
  } finally {
    console.error = originalError;
    container?.remove();
  }

  const isMismatch = (m: string) =>
    /hydrat|did not match|does not match|server (?:HTML|rendered)/i.test(m);

  // Exclusão única e deliberada: o `Presence` do Radix chama `useLayoutEffect`,
  // e o React avisa no passo do servidor que isso "will lead to a mismatch".
  // Aqui não leva: com o diálogo fechado o `Presence` devolve null nos dois
  // lados, `onRecoverableError` fica vazio e o DOM é idêntico. O aviso é de
  // desenvolvimento (o React não o emite em build de produção), vem de dentro de
  // uma dependência e sai em qualquer tela com `Dialog` do shadcn — mantê-lo
  // afogaria o sinal que este teste existe pra ver. Mismatch DE VERDADE continua
  // pego pelo `recoverable`, que é o canal do #418/#423.
  const isRadixLayoutEffectNotice = (m: string) => m.includes("useLayoutEffect does nothing");

  const filtered = consoleErrors.filter((m) => isMismatch(m) && !isRadixLayoutEffectNotice(m));
  if (process.env.DEBUG_HYDRATION) {
    for (const m of consoleErrors) originalError("[console.error]", m.slice(0, 400));
  }
  // Uma linha por aviso distinto — a mensagem do React repete por instância.
  return { recoverable, consoleErrors: [...new Set(filtered.map((m) => m.split("\n")[0]))] };
}

describe("ProposalDetailClient — hidratação servidor × cliente", () => {
  beforeEach(() => {
    // O card Documento dispara POST /preview num efeito PÓS-hidratação. Precisa
    // resolver pra não vazar rejeição, mas não participa do primeiro paint.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        // Resposta com a FORMA real de cada endpoint: um mock genérico faria o
        // polling receber `{}` e o componente quebrar por outro motivo,
        // mascarando o que este teste procura.
        const body = String(url).includes("/status")
          ? {
              status: "enviada",
              dossierUrl: null,
              convertedDealId: null,
              envelopes: [],
              signers: [],
              active: true,
              updatedAt: "2026-07-30T20:23:00.000Z",
            }
          : { html: "<p>preview</p>" };
        return { ok: true, status: 200, json: async () => body };
      }) as unknown as typeof fetch
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("rascunho de locação (1 signatário, sem histórico) hidrata sem mismatch", async () => {
    const report = await hydrateAndCollect(<ProposalDetailClient {...draftProps()} />);
    expect(report.consoleErrors).toEqual([]);
    expect(report.recoverable).toEqual([]);
  });

  it("proposta enviada (snapshot em iframe, histórico, anexos) hidrata sem mismatch", async () => {
    const report = await hydrateAndCollect(<ProposalDetailClient {...sentProps()} />);
    expect(report.consoleErrors).toEqual([]);
    expect(report.recoverable).toEqual([]);
  });

  it("o HTML do servidor já traz as datas formatadas (nada de formatação no client)", () => {
    const html = renderToString(<ProposalDetailClient {...draftProps()} />);
    expect(html).toContain("30/07/2026 17:23");
    expect(html).toContain("faltam 5d");
    expect(html).toContain("R$ 3.500");
    // Se alguém reintroduzir `toLocaleString` com `style: "currency"`, o NBSP do
    // ICU aparece aqui antes de aparecer no smoke.
    expect(html).not.toMatch(/[  ]/);
  });
});
