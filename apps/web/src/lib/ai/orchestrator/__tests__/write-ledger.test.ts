import { describe, it, expect } from "vitest";
import { buildWriteLedger, ledgerIsEmpty, ledgerOutcome } from "../graph";
import type { SpecialistOutput, ToolCallRecord } from "../state";

function editor(toolCalls: ToolCallRecord[]): { editor: SpecialistOutput } {
  return { editor: { text: "narrativa do editor", toolCalls } };
}

describe("buildWriteLedger (B2 anti-confabulação)", () => {
  it("conta edição de doc confirmada (htmlBefore != htmlAfter) como APLICADA", () => {
    const l = buildWriteLedger(
      editor([
        {
          name: "edit_contract_section",
          input: {},
          success: true,
          summary: "substituiu ', .' por data",
          htmlBefore: "...A, ....",
          htmlAfter: "...A Embu-Guaçu, 19 de maio de 2026....",
        },
      ])
    );
    expect(l.applied.length).toBe(1);
    expect(l.notApplied.length).toBe(0);
    expect(ledgerOutcome(l, "edit_simple")).toBe("applied");
  });

  it("edição de doc com sucesso mas SEM mudança no texto vira NÃO APLICADA", () => {
    const l = buildWriteLedger(
      editor([
        {
          name: "edit_contract_section",
          input: {},
          success: true,
          summary: "target não casou",
          htmlBefore: "doc identico",
          htmlAfter: "doc identico",
        },
      ])
    );
    expect(l.applied.length).toBe(0);
    expect(l.notApplied.length).toBe(1);
    expect(ledgerOutcome(l, "edit_simple")).toBe("failed");
  });

  it("zero tools de escrita => ledger vazio e outcome no_op (caso Test A modo Plan)", () => {
    const l = buildWriteLedger({ legal: { text: "consulta jurídica", toolCalls: [] } });
    expect(ledgerIsEmpty(l)).toBe(true);
    expect(ledgerOutcome(l, "informational")).toBe("no_op_informational");
  });

  it("propose_plan/propose_suggestion com sucesso => PENDENTE, não aplicada", () => {
    const l = buildWriteLedger(
      editor([
        { name: "propose_plan", input: {}, success: true, summary: "plano com 3 steps" },
        { name: "propose_suggestion", input: {}, success: true, summary: "sugestão de redação" },
      ])
    );
    expect(l.applied.length).toBe(0);
    expect(l.pending.length).toBe(2);
    expect(ledgerOutcome(l, "edit_multi")).toBe("pending_plan");
  });

  it("propose_plan que falhou (knowledgeItemId vazio) => FALHA (caso Test B)", () => {
    const l = buildWriteLedger(
      editor([
        { name: "propose_plan", input: {}, success: false, summary: 'knowledgeItemId="(vazio)"' },
        { name: "cross_check_certidoes", input: {}, success: true, summary: "OK" },
      ])
    );
    expect(l.applied.length).toBe(0);
    expect(l.pending.length).toBe(0);
    expect(l.failed.length).toBe(1);
    expect(ledgerOutcome(l, "edit_multi")).toBe("failed");
  });

  it("update_contract_data em GDoc => APENAS DADOS (não conta como texto aplicado)", () => {
    const l = buildWriteLedger(
      editor([{ name: "update_contract_data", input: {}, success: true, summary: "patch dataJson" }])
    );
    expect(l.applied.length).toBe(0);
    expect(l.dataOnly.length).toBe(1);
    // dataOnly bem-sucedido é SUCESSO próprio, não "failed" (regressão corrigida).
    expect(ledgerOutcome(l, "update_data")).toBe("applied_data");
  });

  it("pediu edição mas nenhuma escrita aconteceu => no_op_requested (≠ consulta)", () => {
    const l = buildWriteLedger(editor([]));
    expect(ledgerIsEmpty(l)).toBe(true);
    expect(ledgerOutcome(l, "edit_simple")).toBe("no_op_requested");
    expect(ledgerOutcome(l, "informational")).toBe("no_op_informational");
  });

  it("edição aplicada + uma falha => applied_partial", () => {
    const l = buildWriteLedger(
      editor([
        { name: "edit_contract_section", input: {}, success: true, summary: "ok", htmlBefore: "a", htmlAfter: "b" },
        { name: "insert_clause", input: {}, success: false, summary: "cláusula não encontrada" },
      ])
    );
    expect(ledgerOutcome(l, "edit_multi")).toBe("applied_partial");
  });
});
