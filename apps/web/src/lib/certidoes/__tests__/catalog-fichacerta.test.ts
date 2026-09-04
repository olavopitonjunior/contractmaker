import { describe, it, expect } from "vitest";
import { ENDPOINTS, endpointInfo } from "../endpoints";
import { listAllForPicker, listEndpointsByCategory } from "../catalog";
import { TARGET_KINDS } from "../types";
import { TARGET_KIND_LABELS, basePathForTarget } from "../target-paths";

/**
 * Invariante do PR de costura (2026-09-04): os laudos Ficha Certa existem no
 * catálogo, mas ficam INVISÍVEIS ao picker de certidões até o PR que liga o
 * provider (dispatch/runner/webhook). Quem trocar `initialStatus` sem querer
 * expõe UI que não funciona.
 */
describe("catálogo — Ficha Certa fica fora do picker até ser ligado", () => {
  const ids = ["fichacerta/laudo-pf", "fichacerta/laudo-pj"] as const;

  it("as duas entradas existem, com provider/scope próprios", () => {
    for (const id of ids) {
      const e = endpointInfo(id);
      expect(ENDPOINTS[id]).toBeDefined();
      expect(e.provider).toBe("fichacerta");
      expect(e.scope).toBe("credito");
      expect(e.twoStep).toBe(true);
      expect(e.initialStatus).toBe("awaiting_portal");
    }
  });

  it("não aparecem no picker nem na listagem por categoria", () => {
    const picker = listAllForPicker().map((e) => e.id);
    for (const id of ids) expect(picker).not.toContain(id);
    const score = listEndpointsByCategory("score").map((e) => e.id);
    for (const id of ids) expect(score).not.toContain(id);
  });
});

describe("TARGET_KINDS — todo alvo tem label e caminho (conjuge_locatario incluso)", () => {
  it("exaustivo", () => {
    for (const kind of TARGET_KINDS) {
      expect(TARGET_KIND_LABELS[kind]).toBeTruthy();
      expect(typeof basePathForTarget(kind, 0, "locacao")).toBe("string");
    }
    expect(TARGET_KINDS).toContain("conjuge_locatario");
    expect(basePathForTarget("conjuge_locatario", 2, "locacao")).toBe("locatarios.2.conjuge");
  });
});
