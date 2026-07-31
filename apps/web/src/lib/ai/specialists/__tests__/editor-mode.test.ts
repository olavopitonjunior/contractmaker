/**
 * Item 22 — o modo "Planejar" precisa PROPOR, nunca escrever direto.
 *
 * Antes deste lote o `state.mode` só escolhia modelo do aggregator e expert
 * context; o comportamento do Editor dependia só do `intent`, então
 * "altere a multa para 3%" em modo Planejar caía em edit_simple →
 * tool_choice:any → write direto, sem plano e sem aprovação.
 *
 * A matriz abaixo é o contrato do gate. `resolveEditorToolPolicy` é pura de
 * propósito: dá pra travar o comportamento sem subir LLM nem banco.
 */

import { describe, it, expect } from "vitest";
import { resolveEditorToolPolicy } from "../editor";
import { DIRECT_WRITE_TOOLS } from "../../tools";
import type { OrchestratorState } from "../../orchestrator/state";

type PolicyInput = Pick<OrchestratorState, "mode" | "intent" | "userMessage">;

const st = (over: Partial<PolicyInput>): PolicyInput => ({
  mode: "plan",
  intent: "edit_simple",
  userMessage: "altere a multa para 3%",
  ...over,
});

const hasAnyDirectWrite = (names: string[]) =>
  names.some((n) => DIRECT_WRITE_TOOLS.has(n));

describe("modo Planejar (mode=plan)", () => {
  it("edit_simple: sem writes diretos no toolbox e forçado a propose_plan", () => {
    const p = resolveEditorToolPolicy(st({ intent: "edit_simple" }));

    expect(p.planGate).toBe(true);
    expect(hasAnyDirectWrite(p.toolNames)).toBe(false);
    expect(p.toolNames).toContain("propose_plan");
    expect(p.forceToolUse).toBe(true);
    expect(p.forceToolName).toBe("propose_plan");
  });

  it("edit_multi: mesmo gate do edit_simple", () => {
    const p = resolveEditorToolPolicy(
      st({ intent: "edit_multi", userMessage: "altere a multa e troque o fiador" })
    );

    expect(hasAnyDirectWrite(p.toolNames)).toBe(false);
    expect(p.forceToolName).toBe("propose_plan");
  });

  it("propose_suggestion continua disponível (é proposta, não escrita)", () => {
    const p = resolveEditorToolPolicy(st({}));
    expect(p.toolNames).toContain("propose_suggestion");
  });

  it("intent informativo: não força tool alguma, mas segue sem writes diretos", () => {
    const p = resolveEditorToolPolicy(
      st({ intent: "informational", userMessage: "qual é a multa deste contrato?" })
    );

    expect(p.forceToolUse).toBe(false);
    expect(p.forceToolName).toBeUndefined();
    expect(hasAnyDirectWrite(p.toolNames)).toBe(false);
  });
});

describe("modo Rápido (mode=fast) — comportamento histórico intacto", () => {
  it("edit_simple: writes diretos disponíveis e tool forçada (any)", () => {
    const p = resolveEditorToolPolicy(st({ mode: "fast", intent: "edit_simple" }));

    expect(p.planGate).toBe(false);
    expect(p.toolNames).toContain("edit_contract_section");
    expect(p.toolNames).toContain("update_contract_data");
    expect(p.forceToolUse).toBe(true);
    expect(p.forceToolName).toBeUndefined();
  });

  it("edit_multi: não força tool (hint de prompt, como antes)", () => {
    const p = resolveEditorToolPolicy(st({ mode: "fast", intent: "edit_multi" }));
    expect(p.forceToolUse).toBe(false);
    expect(p.forceToolName).toBeUndefined();
  });
});

describe("FORCE_DIRECT_EDIT vence em qualquer modo", () => {
  const escapes = [
    "aplique direto: altere a multa para 3%",
    "altere a multa para 3%, sem revisão",
    "faça já a troca do fiador",
  ];

  for (const msg of escapes) {
    it(`"${msg.slice(0, 28)}…" em modo plan → write direto liberado`, () => {
      const p = resolveEditorToolPolicy(st({ mode: "plan", userMessage: msg }));

      expect(p.wantsDirectEdit).toBe(true);
      expect(p.planGate).toBe(false);
      expect(p.toolNames).toContain("edit_contract_section");
      // As tools de proposta saem do toolbox — o usuário pediu commit agora.
      expect(p.toolNames).not.toContain("propose_plan");
      expect(p.toolNames).not.toContain("propose_suggestion");
      expect(p.forceToolName).toBeUndefined();
    });
  }

  it("também vence em modo fast (comportamento C4 preservado)", () => {
    const p = resolveEditorToolPolicy(
      st({ mode: "fast", userMessage: "aplique direto: altere a multa" })
    );
    expect(p.toolNames).not.toContain("propose_plan");
    expect(p.toolNames).toContain("edit_contract_section");
  });
});

/**
 * O escape é uma regex que casa em QUALQUER posição da mensagem, e várias das
 * expressões são frases de contrato ("rescisão sem revisão judicial"). Colar
 * uma cláusula assim — vinda da contraparte ou do campo de observações do
 * formulário público, que é anônimo — não pode derrubar o gate.
 */
describe("escape não dispara por texto citado de terceiro", () => {
  const citacoes = [
    'inclua esta cláusula: "a rescisão será automática, sem revisão judicial"',
    "inclua esta cláusula: “o aceite se dará sem sugestão de alteração”",
    "avalie este trecho: 'prorrogação automática, sem revisão pelas partes'",
    "compare com ```a parte aceita sem revisão prévia```",
  ];

  for (const msg of citacoes) {
    it(`não escapa: ${msg.slice(0, 34)}…`, () => {
      const p = resolveEditorToolPolicy(st({ mode: "plan", userMessage: msg }));
      expect(p.wantsDirectEdit).toBe(false);
      expect(p.planGate).toBe(true);
      expect(hasAnyDirectWrite(p.toolNames)).toBe(false);
    });
  }

  it("pedido fora das aspas continua escapando, mesmo com citação junto", () => {
    const p = resolveEditorToolPolicy(
      st({
        mode: "plan",
        userMessage:
          'aplique direto: inclua "a rescisão será automática, sem revisão judicial"',
      })
    );
    expect(p.wantsDirectEdit).toBe(true);
    expect(p.toolNames).toContain("edit_contract_section");
  });

  it("apóstrofo de português não come o resto da mensagem", () => {
    const p = resolveEditorToolPolicy(
      st({ mode: "plan", userMessage: "aplique direto: corrija 'd'água' na cláusula 3" })
    );
    expect(p.wantsDirectEdit).toBe(true);
  });
});
