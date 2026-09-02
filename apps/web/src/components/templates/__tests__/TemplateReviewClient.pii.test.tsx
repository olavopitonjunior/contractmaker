import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TemplateReviewClient } from "../TemplateReviewClient";

/**
 * A cadeia slot → PII de UMA tentativa de ativação. O servidor roda a trava do
 * slot primeiro e a de PII depois; cada 409 abre um diálogo com saída
 * consciente. O flag aceito no primeiro elo (`forceActivate`) tem de
 * SOBREVIVER ao segundo (`allowPii`) — senão o terceiro PATCH volta a bater no
 * slot e o modelo fica inativável pela tela (regressão pega em review: o
 * AlertDialogAction do Radix fecha o diálogo via onOpenChange DEPOIS do onClick).
 */
function jsonResponse(status: number, body: unknown) {
  return { ok: status < 300, status, json: async () => body } as Response;
}

const patches: Array<Record<string, unknown>> = [];

function installFetch(patchResponses: Array<() => Response>) {
  let n = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/validate-gdoc")) {
        return jsonResponse(200, {
          found: [],
          unknown: [],
          missingRequired: [],
          catalog: [],
          slots: [],
        });
      }
      if (url.endsWith("/doc-text")) return jsonResponse(200, { paragraphs: [] });
      if (init?.method === "PATCH") {
        patches.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return patchResponses[Math.min(n++, patchResponses.length - 1)]();
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

describe("TemplateReviewClient — cadeia de travas slot → PII", () => {
  beforeEach(() => {
    patches.length = 0;
  });

  it("o flag do slot sobrevive ao diálogo de PII: o 3º PATCH leva forceActivate E allowPii", async () => {
    installFetch([
      () =>
        jsonResponse(409, {
          code: "SLOT_CLAUSE_MISSING",
          error: "Falta a cláusula de garantia no acervo.",
          gaps: [],
        }),
      () =>
        jsonResponse(409, {
          code: "PII_LEFTOVER",
          error: "O texto do modelo ainda tem dado pessoal literal.",
          pii: { kinds: ["cpf"], count: 1 },
        }),
      () => jsonResponse(200, { id: "t1", status: "active" }),
    ]);
    const user = userEvent.setup();
    render(<TemplateReviewClient template={template} />);

    const ativar = await screen.findByRole("button", { name: "Ativar template" });
    await waitFor(() => expect(ativar).not.toBeDisabled());
    await user.click(ativar);

    // 1º 409: slot → aceita
    await screen.findByText("Falta a cláusula deste modelo no acervo");
    await user.click(screen.getByRole("button", { name: "Ativar mesmo assim" }));

    // 2º 409: PII → aceita
    await screen.findByText("O modelo ainda tem dado pessoal no texto");
    await user.click(screen.getByRole("button", { name: "Ativar mesmo assim" }));

    await waitFor(() => expect(patches).toHaveLength(3));
    expect(patches[0]).toEqual({ status: "active" });
    expect(patches[1]).toEqual({ status: "active", forceActivate: true });
    expect(patches[2]).toEqual({ status: "active", forceActivate: true, allowPii: true });
  });

  it("cancelar o diálogo de PII esquece o que já tinha sido aceito", async () => {
    installFetch([
      () => jsonResponse(409, { code: "SLOT_CLAUSE_MISSING", error: "Falta a cláusula.", gaps: [] }),
      () =>
        jsonResponse(409, {
          code: "PII_LEFTOVER",
          error: "Dado pessoal.",
          pii: { kinds: ["cpf"], count: 1 },
        }),
      () => jsonResponse(409, { code: "SLOT_CLAUSE_MISSING", error: "Falta a cláusula.", gaps: [] }),
    ]);
    const user = userEvent.setup();
    render(<TemplateReviewClient template={template} />);
    const ativar = await screen.findByRole("button", { name: "Ativar template" });
    await waitFor(() => expect(ativar).not.toBeDisabled());
    await user.click(ativar);
    await screen.findByText("Falta a cláusula deste modelo no acervo");
    await user.click(screen.getByRole("button", { name: "Ativar mesmo assim" }));
    await screen.findByText("O modelo ainda tem dado pessoal no texto");
    await user.click(screen.getByRole("button", { name: "Voltar e corrigir" }));

    // Nova tentativa começa do zero: o PATCH não carrega forceActivate.
    await user.click(screen.getByRole("button", { name: "Ativar template" }));
    await waitFor(() => expect(patches).toHaveLength(3));
    expect(patches[2]).toEqual({ status: "active" });
  });
});
