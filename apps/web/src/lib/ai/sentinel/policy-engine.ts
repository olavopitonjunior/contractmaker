/**
 * Policy engine — carrega regras YAML em memória e avalia contra propostas
 * de tool_use vindas dos especialistas.
 *
 * Diferentemente de Zod (que valida shape sintático no handler), a policy
 * é uma camada SEMÂNTICA expressando intenção do negócio (allow-list de
 * domínios, requisitos de evidência, limites de budget).
 *
 * Bundling: o YAML é importado de `policy-raw.ts` (string TS embedada)
 * em vez de lido com `fs.readFileSync` em runtime. Razão: Next.js empacota
 * chunks em `.next/server/chunks/` sem copiar assets YAML, e em prod o
 * serverless function falhava com ENOENT toda chamada do orchestrator
 * multi-agent. Detalhes do trade-off em `policy-raw.ts`.
 */

import yaml from "js-yaml";
import { POLICY_YAML_RAW } from "./policy-raw";

export type PolicyAction = "reject" | "warn" | "reject_and_alert";

export interface PolicyRule {
  id: string;
  description?: string;
  when: string;
  action: PolicyAction;
  reason: string;
}

interface PolicyFile {
  rules: PolicyRule[];
}

export interface PolicyContext {
  tool: string;
  input: Record<string, unknown>;
  contractId: string;
  orgId: string;
  userId: string;
  mode: "fast" | "plan";
  trustedScore?: number;
  intent?: string;
  tokensSpent?: number;
  budgetCap?: number;
}

let cachedRules: PolicyRule[] | null = null;

export function loadPolicyRules(): PolicyRule[] {
  if (cachedRules) return cachedRules;
  const parsed = yaml.load(POLICY_YAML_RAW) as PolicyFile | null;
  if (!parsed || !Array.isArray(parsed.rules)) {
    throw new Error("policy YAML inválido — esperado { rules: [...] }");
  }
  cachedRules = parsed.rules;
  return cachedRules;
}

/** Reset pra testes. */
export function __resetPolicyForTests(): void {
  cachedRules = null;
}

// ────────────────────────────────────────────────────────────────────────
// Avaliador da expressão `when`
// ────────────────────────────────────────────────────────────────────────
//
// Suporta um subset enxuto e SEGURO de operadores — NÃO usa eval ou Function
// constructor pra evitar code injection vinda do próprio YAML editável.
//
// Sintaxe suportada:
//   tool == "string"
//   tool != "string"
//   input.<path>.length < N
//   input.<path>.length == N
//   input.<path> == null
//   input.<path> MATCHES "regex"
//   tokensSpent >= budgetCap
//   contains_private_ip(input.<path>)
//   <expr> AND <expr>
//   NOT <expr>
//
// Operadores são parseados num AST simples — sem JIT, sem function constructor.

type Atom = { kind: "compare"; left: string; op: string; right: string };
type Not = { kind: "not"; expr: Expr };
type And = { kind: "and"; left: Expr; right: Expr };
type Or = { kind: "or"; left: Expr; right: Expr };
type Expr = Atom | Not | And | Or;

const FUNCTION_NAMES = ["contains_private_ip"];

function tokenize(input: string): string[] {
  // Split by whitespace but keep quoted strings intact and parens.
  // Function calls (like `contains_private_ip(input.url)`) são tokenizados
  // como ÚNICO token pra simplificar o parser — match por prefixo.
  const tokens: string[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Função: identifica prefixo conhecido + '(' + ... + ')'
    let matchedFn: string | null = null;
    for (const fn of FUNCTION_NAMES) {
      if (input.slice(i, i + fn.length + 1) === fn + "(") {
        matchedFn = fn;
        break;
      }
    }
    if (matchedFn) {
      // Lê até `)` correspondente (sem aninhamento — policy mantém simples).
      const closeIdx = input.indexOf(")", i);
      if (closeIdx < 0) throw new Error(`Função ${matchedFn} sem ')' de fechamento`);
      tokens.push(input.slice(i, closeIdx + 1));
      i = closeIdx + 1;
      continue;
    }

    if (ch === "(" || ch === ")") {
      tokens.push(ch);
      i++;
      continue;
    }
    if (ch === '"') {
      let end = i + 1;
      while (end < input.length && input[end] !== '"') {
        if (input[end] === "\\") end++;
        end++;
      }
      tokens.push(input.slice(i, end + 1));
      i = end + 1;
      continue;
    }
    // Read until next whitespace or paren
    let end = i;
    while (end < input.length && !/[\s()]/.test(input[end])) {
      end++;
    }
    tokens.push(input.slice(i, end));
    i = end;
  }
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: string[]) {}

  parse(): Expr {
    const expr = this.parseOr();
    if (this.pos < this.tokens.length) {
      throw new Error(`Tokens não consumidos: ${this.tokens.slice(this.pos).join(" ")}`);
    }
    return expr;
  }

  private peek(): string | undefined {
    return this.tokens[this.pos];
  }
  private consume(): string {
    return this.tokens[this.pos++];
  }
  private match(token: string): boolean {
    if (this.peek() === token) {
      this.consume();
      return true;
    }
    return false;
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.match("OR")) {
      const right = this.parseAnd();
      left = { kind: "or", left, right };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.match("AND")) {
      const right = this.parseNot();
      left = { kind: "and", left, right };
    }
    return left;
  }

  private parseNot(): Expr {
    if (this.match("NOT")) {
      return { kind: "not", expr: this.parsePrimary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    if (this.match("(")) {
      const expr = this.parseOr();
      if (!this.match(")")) throw new Error("Esperava ')'");
      return expr;
    }
    return this.parseAtom();
  }

  private parseAtom(): Atom {
    const left = this.consume();
    if (!left) throw new Error("Expressão incompleta");
    // Function call form: contains_private_ip(args) — único token graças ao tokenizer.
    if (FUNCTION_NAMES.some((fn) => left.startsWith(fn + "("))) {
      return { kind: "compare", left, op: "fn", right: "" };
    }
    const op = this.consume();
    if (!op) throw new Error(`Operador esperado após '${left}'`);
    const right = this.consume();
    if (right === undefined) throw new Error(`Valor esperado após '${left} ${op}'`);
    return { kind: "compare", left, op, right };
  }
}

// Sentinel — readPath retorna `null` (não undefined) quando path não existe,
// pra `input.evidence == null` funcionar quando o input não tem o campo.
const PATH_NOT_FOUND = Symbol("path-not-found");

function readPath(ctx: PolicyContext, path: string): unknown {
  if (path === "tool") return ctx.tool;
  if (path === "contractId") return ctx.contractId;
  if (path === "orgId") return ctx.orgId;
  if (path === "userId") return ctx.userId;
  if (path === "mode") return ctx.mode;
  if (path === "trustedScore") return ctx.trustedScore;
  if (path === "intent") return ctx.intent;
  if (path === "tokensSpent") return ctx.tokensSpent;
  if (path === "budgetCap") return ctx.budgetCap;
  if (path.startsWith("input.")) {
    const parts = path.slice("input.".length).split(".");
    let cur: unknown = ctx.input;
    for (const p of parts) {
      if (p === "length") {
        if (typeof cur === "string") cur = cur.length;
        else if (Array.isArray(cur)) cur = cur.length;
        else return null;
        continue;
      }
      if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[p];
      } else {
        return null;
      }
    }
    return cur ?? null;
  }
  return PATH_NOT_FOUND;
}

/** Tenta resolver token como path do contexto primeiro; senão, parseia literal. */
function resolveRhs(ctx: PolicyContext, token: string): unknown {
  if (token === undefined) return undefined;
  if (token === "null") return null;
  if (token === "true") return true;
  if (token === "false") return false;
  if (token.startsWith('"') && token.endsWith('"')) {
    return token.slice(1, -1);
  }
  // Tenta como path
  const asPath = readPath(ctx, token);
  if (asPath !== PATH_NOT_FOUND) return asPath;
  // Tenta como number
  const n = Number(token);
  return Number.isFinite(n) ? n : token;
}

const PRIVATE_IP_REGEX =
  /(?:^|\/\/)(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[?::1\]?)/;

function containsPrivateIp(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return PRIVATE_IP_REGEX.test(value);
}

function evalExpr(expr: Expr, ctx: PolicyContext): boolean {
  if (expr.kind === "not") return !evalExpr(expr.expr, ctx);
  if (expr.kind === "and") return evalExpr(expr.left, ctx) && evalExpr(expr.right, ctx);
  if (expr.kind === "or") return evalExpr(expr.left, ctx) || evalExpr(expr.right, ctx);

  // compare
  const { left, op, right } = expr;

  // Function call: contains_private_ip(input.path)
  if (op === "fn" && left.startsWith("contains_private_ip(")) {
    const inner = left.slice("contains_private_ip(".length).replace(/\)$/, "");
    const value = readPath(ctx, inner);
    return containsPrivateIp(value);
  }

  const leftRaw = readPath(ctx, left);
  const leftValue = leftRaw === PATH_NOT_FOUND ? null : leftRaw;
  const rightValue = resolveRhs(ctx, right);

  switch (op) {
    case "==":
      return leftValue === rightValue;
    case "!=":
      return leftValue !== rightValue;
    case "<":
      return Number(leftValue) < Number(rightValue);
    case "<=":
      return Number(leftValue) <= Number(rightValue);
    case ">":
      return Number(leftValue) > Number(rightValue);
    case ">=":
      return Number(leftValue) >= Number(rightValue);
    case "MATCHES":
      if (typeof leftValue !== "string" || typeof rightValue !== "string") return false;
      try {
        return new RegExp(rightValue).test(leftValue);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

export function evaluateRule(rule: PolicyRule, ctx: PolicyContext): boolean {
  const tokens = tokenize(rule.when);
  try {
    const ast = new Parser(tokens).parse();
    return evalExpr(ast, ctx);
  } catch (err) {
    console.error(`[policy-engine] regra ${rule.id} não parseou: ${(err as Error).message}`);
    return false;
  }
}

/** Avalia todas as regras e retorna a primeira match (ou null). */
export function findMatchingRule(ctx: PolicyContext): PolicyRule | null {
  for (const rule of loadPolicyRules()) {
    if (evaluateRule(rule, ctx)) return rule;
  }
  return null;
}
