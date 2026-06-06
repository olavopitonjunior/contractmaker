import { describe, it, expect } from "vitest";
import { unmetDependencies } from "../plan-deps";
import type { PlanStep } from "../types";

function step(partial: Partial<PlanStep> & { id: string }): PlanStep {
  return {
    type: "write",
    tool: "edit_contract_section",
    input: {},
    description: partial.id,
    status: "pending",
    ...partial,
  };
}

describe("unmetDependencies (guarda de #5 — plan-and-approve)", () => {
  it("sem dependsOn → vazio (pode rodar)", () => {
    const s = step({ id: "a" });
    expect(unmetDependencies(s, [s])).toEqual([]);
  });

  it("dependência executada com sucesso → vazio", () => {
    const dep = step({ id: "ins", status: "executed", description: "Inserir cláusula" });
    const s = step({ id: "cmt", dependsOn: ["ins"] });
    expect(unmetDependencies(s, [dep, s])).toEqual([]);
  });

  it("dependência que FALHOU → retorna a dependência (step será pulado)", () => {
    const dep = step({ id: "ins", status: "failed", description: "Inserir cláusula de vistoria" });
    const s = step({ id: "cmt", dependsOn: ["ins"], description: "Comentar sobre a cláusula inserida" });
    const unmet = unmetDependencies(s, [dep, s]);
    expect(unmet).toHaveLength(1);
    expect(unmet[0]).toMatchObject({ id: "ins", status: "failed" });
  });

  it("dependência ainda pendente/rejeitada/pulada → não satisfeita", () => {
    for (const st of ["pending", "rejected", "skipped"] as const) {
      const dep = step({ id: "d", status: st });
      const s = step({ id: "x", dependsOn: ["d"] });
      expect(unmetDependencies(s, [dep, s])).toHaveLength(1);
    }
  });

  it("dependência inexistente → marcada como ausente", () => {
    const s = step({ id: "x", dependsOn: ["nao-existe"] });
    const unmet = unmetDependencies(s, [s]);
    expect(unmet).toEqual([{ id: "nao-existe", description: "passo anterior", status: "ausente" }]);
  });

  it("múltiplas deps: só as não-executadas voltam", () => {
    const ok = step({ id: "ok", status: "executed" });
    const bad = step({ id: "bad", status: "failed", description: "Editar rescisão" });
    const s = step({ id: "x", dependsOn: ["ok", "bad"] });
    const unmet = unmetDependencies(s, [ok, bad, s]);
    expect(unmet.map((u) => u.id)).toEqual(["bad"]);
  });
});
