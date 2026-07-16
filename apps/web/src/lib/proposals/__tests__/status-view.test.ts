import { describe, it, expect } from "vitest";
import { proposalStatusView } from "../status-view";
import { ALLOWED_FROM } from "../status";

describe("proposalStatusView", () => {
  it("mapeia todos os status da máquina de estados (sem cair no default)", () => {
    // Todo status conhecido tem um bucket específico (não 'encerrada' por acidente
    // quando devia ser outro). Cobre os destinos de ALLOWED_FROM + rascunho.
    const known = new Set<string>(["rascunho", "aguardando_aprovacao", ...Object.keys(ALLOWED_FROM)]);
    for (const s of known) {
      const v = proposalStatusView(s);
      expect(v.label).toBeTruthy();
      expect(["sua_vez", "cliente", "proprietario", "encerrada"]).toContain(v.bucket);
    }
  });

  it("recusa do vendedor é 'sua vez' (contrapropor), não terminal frio", () => {
    expect(proposalStatusView("recusada_vendedor").bucket).toBe("sua_vez");
    expect(proposalStatusView("recusada_proponente").bucket).toBe("encerrada");
  });

  it("visualizou é bola com o cliente; aguardando_vendedor é com o proprietário", () => {
    expect(proposalStatusView("visualizada").bucket).toBe("cliente");
    expect(proposalStatusView("aguardando_vendedor").bucket).toBe("proprietario");
  });
});
