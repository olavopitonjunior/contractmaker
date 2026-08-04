import { describe, it, expect, beforeAll, vi } from "vitest";
import { z } from "zod";
import { signerSchema, createSchema, SIGNER_ROLES } from "../create-schema";

/**
 * Paridade entre o contrato da tool MCP `create_proposal` e o Zod da rota
 * `POST /api/proposals`.
 *
 * Por que este teste existe: em 2026-08-04 os dois divergiram sem ninguém
 * notar. A tool descrevia signatários como `{name,email,phone?,documentation?}`
 * — sem `role`, que a rota exige — e TODA proposta criada pelo Newton no
 * WhatsApp voltava 400. O usuário só via "não consegui". A divergência era
 * invisível porque nada comparava os dois lados.
 *
 * `index.ts` do mcp-server faz `process.exit(1)` no top-level quando falta
 * CONTRACTMAKER_API_TOKEN, e `tools.ts` importa `callApi` de lá — daí o mock do
 * módulo: o teste quer as DEFINIÇÕES das tools, não o runtime HTTP.
 */
vi.mock("../../../../../mcp-server/src/index.js", () => ({
  callApi: vi.fn(),
  callBridge: vi.fn(),
  logProactiveOutbound: vi.fn(),
}));

interface JsonSchemaProp {
  type?: string;
  enum?: string[];
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
  items?: JsonSchemaProp;
}

let createProposalInput: JsonSchemaProp;
let explainApiError: (r: { status: number; body: unknown }) => {
  _error: true;
  status: number;
  message: string;
} | null;

beforeAll(async () => {
  const toolsMod = await import("../../../../../mcp-server/src/tools.js");
  const errMod = await import("../../../../../mcp-server/src/api-error.js");
  explainApiError = errMod.explainApiError;

  const tool = (toolsMod.tools as Array<{ name: string; inputSchema: JsonSchemaProp }>).find(
    (t) => t.name === "create_proposal"
  );
  if (!tool) throw new Error("tool create_proposal não encontrada");
  createProposalInput = tool.inputSchema;
});

/** Chaves obrigatórias de um ZodObject = as que não são optional. */
function requiredKeys(schema: z.ZodObject<z.ZodRawShape>): string[] {
  return Object.entries(schema.shape)
    .filter(([, v]) => !(v as z.ZodTypeAny).isOptional())
    .map(([k]) => k)
    .sort();
}

function knownKeys(schema: z.ZodObject<z.ZodRawShape>): string[] {
  return Object.keys(schema.shape).sort();
}

describe("paridade create_proposal (tool MCP) ↔ POST /api/proposals (Zod)", () => {
  it("declara signers como objeto tipado, não `{type:'object'}` livre", () => {
    const signers = createProposalInput.properties?.signers;
    expect(signers?.type).toBe("array");
    expect(signers?.items?.properties).toBeDefined();
  });

  it("exige em signers.items.required tudo que o Zod exige", () => {
    const toolRequired = [...(createProposalInput.properties?.signers?.items?.required ?? [])].sort();
    // O bug original: `role` era obrigatório no Zod e nem aparecia na tool.
    expect(toolRequired).toEqual(requiredKeys(signerSchema));
    expect(toolRequired).toContain("role");
  });

  it("usa exatamente os papéis que o Zod aceita", () => {
    const toolRoles = createProposalInput.properties?.signers?.items?.properties?.role?.enum;
    expect([...(toolRoles ?? [])].sort()).toEqual([...SIGNER_ROLES].sort());
  });

  it("não declara nenhuma propriedade de signer que o Zod desconheça", () => {
    // Pega o `documentation` fantasma: a tool o anunciava, o Zod o descartava
    // no strip, e o CPF nunca chegava no banco.
    const toolProps = Object.keys(
      createProposalInput.properties?.signers?.items?.properties ?? {}
    );
    const zodKeys = knownKeys(signerSchema);
    expect(toolProps.filter((p) => !zodKeys.includes(p))).toEqual([]);
  });

  it("não declara nenhum campo de topo que o Zod desconheça", () => {
    const toolProps = Object.keys(createProposalInput.properties ?? {});
    const zodKeys = knownKeys(createSchema);
    expect(toolProps.filter((p) => !zodKeys.includes(p))).toEqual([]);
  });

  it("mantém title e schemaType obrigatórios nos dois lados", () => {
    expect([...(createProposalInput.required ?? [])].sort()).toEqual(
      requiredKeys(createSchema).filter((k) => k !== "dataJson")
    );
  });
});

describe("explainApiError — nunca vaza interno pro WhatsApp", () => {
  it("devolve null quando deu certo", () => {
    expect(explainApiError({ status: 201, body: { proposal: { id: "x" } } })).toBeNull();
  });

  it("traduz a falha real de 04/08 (signers sem role) em linguagem de negócio", () => {
    const body = {
      error: "…",
      issues: [
        {
          code: "invalid_type",
          expected: "'proponente' | 'vendedor' | 'conjuge' | 'testemunha'",
          received: "undefined",
          path: ["signers", 0, "role"],
          message: "Required",
        },
      ],
    };
    const out = explainApiError({ status: 400, body })!;
    expect(out._error).toBe(true);
    expect(out.message).toContain("papel");
    expect(out.message).not.toMatch(/signers|role|invalid_type|undefined/);
  });

  it("lê issues do corpo antigo, em que vinham stringificadas dentro de `error`", () => {
    const body = {
      error: JSON.stringify([{ path: ["title"], code: "too_small", message: "Required" }]),
    };
    const out = explainApiError({ status: 400, body })!;
    expect(out.message).toContain("título");
  });

  it("cai no genérico quando não sabe traduzir, sem repassar o corpo cru", () => {
    const body = { error: "Prisma error P2002 on constraint proposal_pkey" };
    const out = explainApiError({ status: 400, body })!;
    expect(out.message).not.toContain("Prisma");
    expect(out.message).not.toContain("P2002");
    expect(out.message).toBe("Não consegui registrar a proposta com esses dados.");
  });

  it("dá mensagem específica pro 409 de contato duplicado", () => {
    const out = explainApiError({ status: 409, body: { error: "…" } })!;
    expect(out.message).toContain("mesmo contato");
  });

  it("agrega várias issues sem repetir a mesma frase", () => {
    const body = {
      issues: [
        { path: ["signers", 0, "role"], message: "Required" },
        { path: ["signers", 1, "role"], message: "Required" },
        { path: ["title"], message: "Required" },
      ],
    };
    const out = explainApiError({ status: 400, body })!;
    expect(out.message.match(/papel/g)?.length).toBe(1);
    expect(out.message).toContain("título");
  });
});
