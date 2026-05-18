import { describe, it, expect } from "vitest";
import { AGENT_TOOLS, getToolNames } from "../tools";

describe("AGENT_TOOLS", () => {
  it("has exactly 20 tools", () => {
    // 2026-05-18 — query_clauses removida na unificação Clause→KnowledgeItem.
    expect(AGENT_TOOLS).toHaveLength(20);
  });

  it("each tool has name, description, and input_schema", () => {
    for (const tool of AGENT_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.input_schema).toBeDefined();
      expect(tool.input_schema.type).toBe("object");
    }
  });

  it("has no duplicate tool names", () => {
    const names = AGENT_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("contains all expected tools", () => {
    const names = AGENT_TOOLS.map((t) => t.name);
    const expected = [
      "query_templates",
      "explain_clause",
      "edit_contract_section",
      "update_contract_data",
      "propose_suggestion",
      "insert_clause",
      "remove_clause",
      "validate_contract",
      "suggest_improvements",
      "extract_document_data",
      "add_comment",
      "analyze_contradictions",
      "query_knowledge_base",
      "find_similar_contracts",
      "propose_new_clause",
      "propose_template_change",
      "apply_style_preset",
      "insert_image",
      "propose_plan",
      "cross_check_certidoes",
    ];
    for (const name of expected) {
      expect(names).toContain(name);
    }
  });

  it("does NOT contain query_clauses (removed in unification)", () => {
    const names = AGENT_TOOLS.map((t) => t.name);
    expect(names).not.toContain("query_clauses");
  });

  it("query_knowledge_base accepts category 'clause' and groupCode", () => {
    const tool = AGENT_TOOLS.find((t) => t.name === "query_knowledge_base");
    expect(tool).toBeDefined();
    const props = tool!.input_schema.properties as Record<string, unknown>;
    const categoryProp = props.category as { enum?: string[] };
    expect(categoryProp.enum).toContain("clause");
    expect(props.groupCode).toBeDefined();
  });

  it("insert_clause uses knowledgeItemId as required input", () => {
    const tool = AGENT_TOOLS.find((t) => t.name === "insert_clause");
    expect(tool).toBeDefined();
    const required = tool!.input_schema.required as string[];
    expect(required).toContain("knowledgeItemId");
    expect(required).not.toContain("clauseId");
  });

  it("remove_clause uses knowledgeItemId as required input", () => {
    const tool = AGENT_TOOLS.find((t) => t.name === "remove_clause");
    expect(tool).toBeDefined();
    const required = tool!.input_schema.required as string[];
    expect(required).toContain("knowledgeItemId");
    expect(required).not.toContain("clauseId");
  });
});

describe("getToolNames", () => {
  it("returns array of 20 tool names", () => {
    const names = getToolNames();
    expect(names).toHaveLength(20);
    expect(names).not.toContain("query_clauses");
    expect(names).toContain("validate_contract");
    expect(names).toContain("add_comment");
    expect(names).toContain("analyze_contradictions");
    expect(names).toContain("cross_check_certidoes");
    expect(names).toContain("query_knowledge_base");
    expect(names).toContain("find_similar_contracts");
    expect(names).toContain("propose_new_clause");
    expect(names).toContain("propose_template_change");
    expect(names).toContain("apply_style_preset");
    expect(names).toContain("insert_image");
  });
});
