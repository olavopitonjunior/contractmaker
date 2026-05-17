import { describe, it, expect, beforeEach } from "vitest";
import {
  evaluateRule,
  findMatchingRule,
  loadPolicyRules,
  __resetPolicyForTests,
  type PolicyContext,
  type PolicyRule,
} from "../policy-engine";

function ctx(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    tool: "edit_contract_section",
    input: {},
    contractId: "c1",
    orgId: "o1",
    userId: "u1",
    mode: "plan",
    ...overrides,
  };
}

describe("policy-engine — evaluateRule", () => {
  beforeEach(() => __resetPolicyForTests());

  it("compara igualdade de tool", () => {
    const rule: PolicyRule = {
      id: "test_eq",
      when: 'tool == "insert_image"',
      action: "reject",
      reason: "",
    };
    expect(evaluateRule(rule, ctx({ tool: "insert_image" }))).toBe(true);
    expect(evaluateRule(rule, ctx({ tool: "edit_contract_section" }))).toBe(false);
  });

  it("compara diferença de tool", () => {
    const rule: PolicyRule = {
      id: "test_neq",
      when: 'tool != "edit_contract_section"',
      action: "warn",
      reason: "",
    };
    expect(evaluateRule(rule, ctx({ tool: "insert_image" }))).toBe(true);
    expect(evaluateRule(rule, ctx({ tool: "edit_contract_section" }))).toBe(false);
  });

  it("MATCHES com regex", () => {
    // Em JS string \\. = 2 chars (\\. literal). new RegExp() lê isso como
    // `\\.` no padrão → escaped dot regex. Match dots literais.
    const rule: PolicyRule = {
      id: "test_match",
      when: 'input.url MATCHES "^https://[a-z]+\\.public\\.blob\\.vercel-storage\\.com/"',
      action: "reject",
      reason: "",
    };
    expect(
      evaluateRule(
        rule,
        ctx({ input: { url: "https://abc.public.blob.vercel-storage.com/x.png" } })
      )
    ).toBe(true);
    expect(evaluateRule(rule, ctx({ input: { url: "https://attacker.com/x.png" } }))).toBe(false);
  });

  it("input path null check", () => {
    const rule: PolicyRule = {
      id: "test_null",
      when: "input.evidence == null",
      action: "reject",
      reason: "",
    };
    expect(evaluateRule(rule, ctx({ input: {} }))).toBe(true);
    expect(evaluateRule(rule, ctx({ input: { evidence: [] } }))).toBe(false);
  });

  it("length comparison", () => {
    const rule: PolicyRule = {
      id: "test_length",
      when: "input.evidence.length < 1",
      action: "reject",
      reason: "",
    };
    expect(evaluateRule(rule, ctx({ input: { evidence: [] } }))).toBe(true);
    expect(evaluateRule(rule, ctx({ input: { evidence: ["a"] } }))).toBe(false);
  });

  it("AND combinator", () => {
    const rule: PolicyRule = {
      id: "test_and",
      when: 'tool == "x" AND input.y == "z"',
      action: "reject",
      reason: "",
    };
    expect(evaluateRule(rule, ctx({ tool: "x", input: { y: "z" } }))).toBe(true);
    expect(evaluateRule(rule, ctx({ tool: "x", input: { y: "w" } }))).toBe(false);
    expect(evaluateRule(rule, ctx({ tool: "other", input: { y: "z" } }))).toBe(false);
  });

  it("NOT prefix", () => {
    const rule: PolicyRule = {
      id: "test_not",
      when: 'NOT tool == "x"',
      action: "reject",
      reason: "",
    };
    expect(evaluateRule(rule, ctx({ tool: "y" }))).toBe(true);
    expect(evaluateRule(rule, ctx({ tool: "x" }))).toBe(false);
  });

  it("budget_exceeded numeric compare", () => {
    const rule: PolicyRule = {
      id: "test_budget",
      when: "tokensSpent >= budgetCap",
      action: "reject",
      reason: "",
    };
    expect(evaluateRule(rule, ctx({ tokensSpent: 200_000, budgetCap: 200_000 }))).toBe(true);
    expect(evaluateRule(rule, ctx({ tokensSpent: 199_999, budgetCap: 200_000 }))).toBe(false);
  });

  it("contains_private_ip helper", () => {
    const rule: PolicyRule = {
      id: "test_ip",
      when: "contains_private_ip(input.url)",
      action: "reject",
      reason: "",
    };
    expect(evaluateRule(rule, ctx({ input: { url: "http://192.168.0.1/x" } }))).toBe(true);
    expect(evaluateRule(rule, ctx({ input: { url: "http://10.0.0.5/x" } }))).toBe(true);
    expect(evaluateRule(rule, ctx({ input: { url: "https://example.com/x" } }))).toBe(false);
  });
});

describe("policy-engine — findMatchingRule", () => {
  beforeEach(() => __resetPolicyForTests());

  it("carrega policy.yaml e match `no_external_url_in_insert_image`", () => {
    const matched = findMatchingRule(
      ctx({
        tool: "insert_image",
        input: { url: "https://attacker.com/evil.png" },
      })
    );
    expect(matched).not.toBeNull();
    expect(matched?.id).toBe("no_external_url_in_insert_image");
  });

  it("permite URLs Vercel Blob", () => {
    const matched = findMatchingRule(
      ctx({
        tool: "insert_image",
        input: { url: "https://abc.public.blob.vercel-storage.com/logo.png" },
      })
    );
    expect(matched).toBeNull();
  });

  it("rejeita propose_template_change sem evidence", () => {
    const matched = findMatchingRule(
      ctx({
        tool: "propose_template_change",
        input: { evidence: [] },
      })
    );
    expect(matched).not.toBeNull();
    expect(matched?.id).toBe("no_template_change_without_evidence");
  });

  it("aceita propose_template_change com evidence", () => {
    const matched = findMatchingRule(
      ctx({
        tool: "propose_template_change",
        input: { evidence: ["memId1"] },
      })
    );
    expect(matched).toBeNull();
  });

  it("budget_exceeded bloqueia qualquer tool", () => {
    const matched = findMatchingRule(
      ctx({
        tool: "edit_contract_section",
        tokensSpent: 250_000,
        budgetCap: 200_000,
      })
    );
    expect(matched).not.toBeNull();
    expect(matched?.id).toBe("budget_exceeded");
  });
});

describe("policy.yaml file", () => {
  beforeEach(() => __resetPolicyForTests());
  it("carrega ao menos 3 regras", () => {
    const rules = loadPolicyRules();
    expect(rules.length).toBeGreaterThanOrEqual(3);
    const ids = rules.map((r) => r.id);
    expect(ids).toContain("no_external_url_in_insert_image");
    expect(ids).toContain("no_template_change_without_evidence");
    expect(ids).toContain("budget_exceeded");
  });
});
