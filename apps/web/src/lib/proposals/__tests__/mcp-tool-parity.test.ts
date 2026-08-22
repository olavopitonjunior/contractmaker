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

let buildProposalPayload: (a: Record<string, unknown>) => {
  ok: boolean;
  message?: string;
  body?: Record<string, unknown>;
};
let createProposalInput: JsonSchemaProp;
let explainApiError: (r: { status: number; body: unknown }) => {
  _error: true;
  status: number;
  message: string;
} | null;

beforeAll(async () => {
  const toolsMod = await import("../../../../../mcp-server/src/tools.js");
  const errMod = await import("../../../../../mcp-server/src/api-error.js");
  const payloadMod = await import("../../../../../mcp-server/src/proposal-payload.js");
  explainApiError = errMod.explainApiError;
  buildProposalPayload = payloadMod.buildProposalPayload;

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
  // A tool NÃO espelha mais o Zod campo a campo: ela recebe o que o corretor
  // fala (proponente/imóvel/valor/canal) e MONTA o corpo. A paridade que
  // importa agora é a de saída — o que ela monta tem de passar no Zod da rota,
  // sempre. Antes, quando o agente montava `dataJson` e `signers` sozinho, a
  // divergência silenciosa gerava PDF vazio e 400 por `role` faltando.
  const ARGS = {
    schemaType: "compra_venda_v1",
    proponente: { nome: "Patrícia Andrade", telefone: "11970325533", cpf: "390.533.447-05" },
    imovel: { endereco: "Rua Senador Godói, 606", cidade: "São Paulo", uf: "SP" },
    valor: 1000000,
    canal: "whatsapp",
  };

  it("o corpo montado passa no Zod da rota", () => {
    const out = buildProposalPayload(ARGS);
    expect(out.ok).toBe(true);
    const parsed = createSchema.safeParse(out.body);
    if (!parsed.success) throw new Error(parsed.error.message);
    expect(parsed.success).toBe(true);
  });

  it("com vendedor, também passa — e com os dois papéis válidos", () => {
    const out = buildProposalPayload({
      ...ARGS,
      vendedor: { nome: "Júnior Garrido", telefone: "13997826692" },
    });
    const parsed = createSchema.safeParse(out.body);
    expect(parsed.success).toBe(true);
    const roles = (out.body!.signers as Array<{ role: string }>).map((s) => s.role);
    expect(roles.every((r) => (SIGNER_ROLES as readonly string[]).includes(r))).toBe(true);
  });

  it("todo signatário montado tem os campos obrigatórios do Zod", () => {
    const out = buildProposalPayload(ARGS);
    const obrigatorios = requiredKeys(signerSchema);
    for (const s of out.body!.signers as Array<Record<string, unknown>>) {
      for (const k of obrigatorios) expect(s[k]).toBeTruthy();
    }
  });

  it("não monta chave que o Zod desconheça (o `documentation` fantasma)", () => {
    const out = buildProposalPayload(ARGS);
    const topo = knownKeys(createSchema);
    expect(Object.keys(out.body!).filter((k) => !topo.includes(k))).toEqual([]);
    const doSigner = knownKeys(signerSchema);
    for (const s of out.body!.signers as Array<Record<string, unknown>>) {
      expect(Object.keys(s).filter((k) => !doSigner.includes(k))).toEqual([]);
    }
  });

  it("a tool exige o mínimo no próprio inputSchema", () => {
    expect([...(createProposalInput.required ?? [])].sort()).toEqual(
      ["canal", "imovel", "proponente", "schemaType", "valor"]
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

  it("repassa a frase que o servidor escreveu pro usuário", () => {
    // O 409 de contato pós-envio: a explicação do servidor diz o que fazer, e
    // perdê-la foi o que deixou o agente sem saída no incidente de 04/08.
    const body = {
      error:
        "A ClickSign não permite trocar o contato de um signatário depois que o documento já foi enviado. Cancele e envie de novo com o contato correto.",
    };
    const out = explainApiError({ status: 409, body })!;
    expect(out.message).toContain("Cancele e envie de novo");
  });

  it("nunca repassa código de erro solto como se fosse explicação", () => {
    // O 422 de preflight vinha com `error:"preflight"` e nada mais. O agente
    // repassava isso e, sem saber a causa, inventava uma — disse ao corretor
    // que faltava o e-mail da compradora quando o furo era outro signatário.
    const out = explainApiError({ status: 422, body: { error: "preflight" } })!;
    expect(out.message).not.toContain("preflight");
    expect(out.message).toBe("Faltam informações para seguir com o envio.");
  });

  it("prefere `message` quando `error` é só o código", () => {
    const body = {
      error: "preflight",
      message: "Vendedor: Informe o nome completo (nome e sobrenome).",
    };
    const out = explainApiError({ status: 422, body })!;
    expect(out.message).toContain("Vendedor");
    expect(out.message).toContain("nome completo");
  });

  it("não repassa JSON nem stack disfarçados de mensagem", () => {
    // NB: array de issues do Zod NÃO entra aqui de propósito — aquilo o
    // tradutor entende e vira frase de negócio, que é o comportamento correto.
    for (const error of [
      '{"detail":"envelope_signer not found","code":404}',
      "TypeError: undefined is not a function\n    at foo (/app/x.js:1:1)",
      "{ code: 'P2002' }",
    ]) {
      const out = explainApiError({ status: 409, body: { error } })!;
      expect(out.message).toBe("Não deu pra fazer essa alteração no estado atual da proposta.");
    }
  });

  it("402 explica limite do PLANO ClickSign, não 'dados errados'", () => {
    // body real: { error: <msg>, code: "CLICKSIGN_PLAN_LIMIT" }. Não pode
    // voltar a falar em orçamento: não existe teto de gasto na plataforma.
    const out = explainApiError({
      status: 402,
      body: { error: "budget", code: "CLICKSIGN_PLAN_LIMIT" },
    })!;
    expect(out.message).toContain("ClickSign");
    expect(out.message).not.toContain("dados");
    expect(out.message).not.toMatch(/orçamento/i);
  });

  it("dá mensagem específica pro 409 de contato duplicado", () => {
    // Texto real que a rota devolve — chega ao corretor como está.
    const body = {
      error:
        "Dois signatários têm o mesmo contato. Informe e-mail ou CPF distinto para cada um (cada pessoa assina separadamente).",
    };
    const out = explainApiError({ status: 409, body })!;
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
