import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { TemplateReviewClient } from "../TemplateReviewClient";

/**
 * O catálogo mostra, embaixo de cada chave AUSENTE, por que o passe de IA não
 * a confirmou — com o trecho já mascarado. Chave que a IA nem tentou fica em
 * silêncio. Relatório antigo (`notMapped: string[]`) não quebra a tela.
 */
function jsonResponse(status: number, body: unknown) {
  return { ok: status < 300, status, json: async () => body } as Response;
}

function installFetch(catalog: Array<{ token: string; present: boolean; required?: boolean }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/validate-gdoc")) {
        return jsonResponse(200, {
          found: catalog.filter((c) => c.present).map((c) => c.token),
          unknown: [],
          missingRequired: [],
          catalog: catalog.map((c) => ({
            token: c.token,
            label: `Rótulo ${c.token}`,
            description: "",
            required: c.required ?? false,
            kind: "simple",
            present: c.present,
          })),
          slots: [],
        });
      }
      if (url.endsWith("/doc-text")) return jsonResponse(200, { paragraphs: [] });
      return jsonResponse(404, {});
    })
  );
}

const base = {
  id: "t1",
  name: "Locação residencial — fiador",
  modalidade: "locacao",
  status: "draft",
  isDefault: false,
  docId: "doc-1",
  embedLink: "about:blank",
};

describe("TemplateReviewClient — motivo por chave ausente", () => {
  it("mostra motivo + trecho mascarado só para chave ausente que a IA tentou", async () => {
    installFetch([
      { token: "aluguel_valor", present: true },
      { token: "aluguel_dia_vencimento", present: false },
      { token: "imovel_identificacao", present: false },
    ]);
    const template = {
      ...base,
      draftReport: {
        ranAt: "2026-09-02T12:00:00.000Z",
        inserted: [{ token: "aluguel_valor", trecho: "R$ 2.500,00" }],
        skippedAmbiguous: [],
        notMapped: [
          { token: "aluguel_dia_vencimento", reason: "ambiguous", trecho: "dia 10 (dez)" },
          { token: "imovel_identificacao", reason: "no-mapping" },
        ],
      },
    };
    render(<TemplateReviewClient template={template} />);

    await waitFor(() => expect(screen.getByText("Rótulo aluguel_dia_vencimento")).toBeTruthy());
    // Ausente e tentada: motivo traduzido + trecho.
    expect(screen.getByText(/aparece em mais de um lugar/)).toBeTruthy();
    expect(screen.getByText(/dia 10 \(dez\)/)).toBeTruthy();
    // Ausente e não tentada: silêncio (nenhuma linha "chave fora do catálogo"
    // nem "no-mapping" cru).
    expect(screen.queryByText(/no-mapping/)).toBeNull();
    // Presente: nada.
    expect(screen.queryByText(/R\$ 2\.500,00/)).toBeNull();
  });

  it("card 'Troca pelo gabarito': confirmados, deixados para revisão com motivo/ocorrências, valor mascarado; not-found não polui", async () => {
    installFetch([{ token: "imovel_matricula", present: false }]);
    const template = {
      ...base,
      draftReport: {
        ranAt: "2026-09-02T12:00:00.000Z",
        inserted: [],
        skippedAmbiguous: [],
        notMapped: [
          { token: "imovel_matricula", reason: "not-specific", sourceValue: "Bloco A", occurrences: 2 },
        ],
        reverseMerge: {
          replaced: [{ token: "aluguel_valor", value: "R$ 2.500,00", occurrences: 3 }],
          skipped: [
            { token: "imovel_matricula", value: "Bloco A", reason: "not-specific", occurrences: 2 },
            { token: "locatarios_qualificacao", value: "Ana, CPF 529.982.247-25", reason: "not-found" },
          ],
        },
      },
    };
    render(<TemplateReviewClient template={template} />);
    await waitFor(() => expect(screen.getByText("Troca pelo gabarito")).toBeTruthy());
    expect(screen.getByText(/alguns em mais de um trecho/)).toBeTruthy();
    expect(screen.getAllByText(/genérico demais para trocar em todo lugar/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\(2×\)/).length).toBeGreaterThan(0);
    // not-found não vira linha (não é ação para o operador) — o CPF nem chega a renderizar.
    expect(screen.queryByText(/529\.982\.247-25/)).toBeNull();
    expect(screen.queryByText(/não encontrei no texto/)).toBeNull();
    // No catálogo, a chave ausente mostra o gabarito. O catálogo vem do
    // `validate-gdoc` (assíncrono), não do relatório: esperar só pelo card
    // síncrono acima deixava esta asserção correr contra a validação — passava
    // local e falhou no CI (run 33941488580).
    await waitFor(() => expect(screen.getByText(/gabarito: “Bloco A”/)).toBeTruthy());
  });

  it("relatório antigo com notMapped: string[] renderiza sem quebrar e sem motivo", async () => {
    installFetch([{ token: "aluguel_dia_vencimento", present: false }]);
    const template = {
      ...base,
      draftReport: {
        ranAt: "2026-08-01T12:00:00.000Z",
        inserted: [],
        skippedAmbiguous: [],
        notMapped: ["aluguel_dia_vencimento"],
      },
    };
    render(<TemplateReviewClient template={template} />);
    await waitFor(() => expect(screen.getByText("Rótulo aluguel_dia_vencimento")).toBeTruthy());
    expect(screen.queryByText(/no-mapping/)).toBeNull();
    expect(screen.queryByText(/aparece em mais de um lugar/)).toBeNull();
  });
});
