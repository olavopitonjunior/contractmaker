import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { TemplateReviewClient } from "../TemplateReviewClient";

/**
 * A ligação da aba "Cláusulas" com o servidor: o fonte é buscado UMA vez ao
 * abrir a aba, e a ação por linha vira a MESMA chamada de `doc-edit` que o
 * card "Problemas" usa — com a frase do Doc e as chaves, nunca um achado
 * inventado pela tela.
 */
function jsonResponse(status: number, body: unknown) {
  return { ok: status < 300, status, json: async () => body } as Response;
}

const DOC = ["a) {{corretagem_qualificacao}}, como intermediadora imobiliária;"];
const SRC = ["a) Imob Ltda, CNPJ 11.111.111/0001-11, como intermediadora imobiliária;"];
const CATALOG = [
  { token: "corretagem_qualificacao", label: "Qualificação do corretor", description: "", required: false, kind: "simple", present: true },
  { token: "imobiliaria_qualificacao", label: "Qualificação da imobiliária", description: "", required: false, kind: "simple", present: false },
];

const calls: Array<{ url: string; method: string; body?: unknown }> = [];

function installFetch(sourceBody: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url.endsWith("/validate-gdoc")) {
        return jsonResponse(200, {
          found: ["corretagem_qualificacao"],
          unknown: [],
          missingRequired: [],
          catalog: CATALOG,
          slots: [],
          semantic: { findings: [], checkedAt: "x", sourceAvailable: true, orgFactsAvailable: true },
        });
      }
      if (url.endsWith("/doc-text")) return jsonResponse(200, { paragraphs: DOC });
      if (url.endsWith("/source-text")) return jsonResponse(200, sourceBody);
      if (url.endsWith("/doc-edit")) {
        return jsonResponse(200, {
          ok: true,
          results: [{ op: "rekey", status: "applied" }],
          appliedAt: "x",
          validation: null,
        });
      }
      return jsonResponse(404, {});
    })
  );
}

const template = {
  id: "t1",
  name: "Locação residencial — fiador",
  modalidade: "locacao",
  status: "draft",
  isDefault: false,
  draftReport: null,
  docId: "doc-1",
  embedLink: "about:blank",
};

describe("TemplateReviewClient — aba Cláusulas", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("abrir a aba busca o original uma vez e alinha com o Doc; trocar a chave posta o doc-edit", async () => {
    installFetch({ available: true, paragraphs: SRC, itemId: "i1", runId: "r1" });
    render(<TemplateReviewClient template={template} />);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/doc-text"))).toBe(true));

    await userEvent.click(screen.getByRole("button", { name: "Cláusulas" }));
    const linha = await screen.findByTestId("clause-row");
    expect(linha.getAttribute("data-kind")).toBe("tokenized");
    expect(within(linha).getByText(SRC[0])).toBeInTheDocument();
    expect(calls.filter((c) => c.url.endsWith("/source-text"))).toHaveLength(1);

    // Sair e voltar não busca de novo: o fonte é o texto do lote, não muda.
    await userEvent.click(screen.getByRole("button", { name: "Documento" }));
    await userEvent.click(screen.getByRole("button", { name: "Cláusulas" }));
    expect(calls.filter((c) => c.url.endsWith("/source-text"))).toHaveLength(1);

    // O botão depende do catálogo (kind "simple"), que vem do `validate-gdoc`
    // assíncrono — a linha pode aparecer antes de a validação voltar.
    await userEvent.click(await screen.findByRole("button", { name: "Trocar chave…" }));
    await userEvent.selectOptions(screen.getByLabelText("Nova chave"), "imobiliaria_qualificacao");
    await userEvent.click(screen.getByRole("button", { name: "Trocar" }));

    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/doc-edit"))).toBe(true));
    const edit = calls.find((c) => c.url.endsWith("/doc-edit"))!;
    expect(edit.method).toBe("POST");
    expect(edit.body).toEqual({
      ops: [
        {
          op: "rekey",
          phrase: DOC[0],
          fromToken: "corretagem_qualificacao",
          toToken: "imobiliaria_qualificacao",
        },
      ],
    });
    // Depois da edição o Doc é relido (o texto da aba precisa refletir a troca).
    await waitFor(() =>
      expect(calls.filter((c) => c.url.endsWith("/doc-text")).length).toBeGreaterThanOrEqual(2)
    );
  });

  it("modelo sem lote: a aba abre em uma coluna e diz por quê", async () => {
    installFetch({ available: false, paragraphs: [] });
    render(<TemplateReviewClient template={template} />);
    await userEvent.click(screen.getByRole("button", { name: "Cláusulas" }));
    expect(await screen.findByText(/Sem arquivo original para comparar/)).toBeInTheDocument();
    expect(screen.queryByText(/original ¶/)).not.toBeInTheDocument();
  });
});
