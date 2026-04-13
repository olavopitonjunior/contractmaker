import { describe, it, expect } from "vitest";
import { AGENT_TOOLS, getToolNames } from "../tools";

describe("AGENT_TOOLS", () => {
  it("has exactly 11 tools", () => {
    expect(AGENT_TOOLS).toHaveLength(11);
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
      "query_clauses",
      "query_templates",
      "explain_clause",
      "edit_contract_section",
      "update_contract_data",
      "insert_clause",
      "remove_clause",
      "validate_contract",
      "suggest_improvements",
      "extract_document_data",
      "add_comment",
    ];
    for (const name of expected) {
      expect(names).toContain(name);
    }
  });
});

describe("getToolNames", () => {
  it("returns array of 11 tool names", () => {
    const names = getToolNames();
    expect(names).toHaveLength(11);
    expect(names).toContain("query_clauses");
    expect(names).toContain("validate_contract");
    expect(names).toContain("add_comment");
  });
});
