import { GoogleGenAI } from "@google/genai";
import { recordAIUsage, geminiUsageToTokens } from "@/lib/ai/usage";
import type { GeminiUsageMetadata } from "@/lib/ai/usage";

/**
 * Input de voz no formulário público → autopreenchimento de campos.
 *
 * Gemini 2.5 Flash aceita áudio nativo via `inlineData`. Retornamos JSON
 * estruturado via `responseMimeType: "application/json"` — campos vão direto
 * pro `form.setValue` no cliente sem segunda hop de LLM.
 *
 * Prompt é schema-aware: cada step do form recebe descrição apenas das
 * chaves daquele step. Reduz tokens e aumenta precisão.
 *
 * Best-effort: erros viram JSON vazio. Voz é "atalho" — falha cai em
 * digitação manual sem bloquear o flow.
 */

let genaiClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI {
  if (!genaiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY não configurada");
    }
    genaiClient = new GoogleGenAI({ apiKey });
  }
  return genaiClient;
}

export const SUPPORTED_VOICE_MIMES = new Set<string>([
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/ogg",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/wav",
]);

export interface VoiceExtractContext {
  orgId: string;
  userId?: string | null;
}

const VOICE_MODEL = process.env.VOICE_EXTRACTION_MODEL || "gemini-2.5-flash";

interface StepSchemaSpec {
  description: string;
  /** Sub-paths a citar no prompt. Caller decide o que faz sentido cobrir. */
  paths: ReadonlyArray<{ path: string; hint: string }>;
}

/** Esteira do formulário — os índices de step significam coisas diferentes. */
export type VoiceEsteira = "venda" | "locacao";

/**
 * Resumo do schema por step. Não é exaustivo — pega o "núcleo" dos campos
 * comumente preenchidos por voz. Caller pode filtrar mais via `pathScope`.
 *
 * Indexado por ESTEIRA porque os índices colidem: em venda 1=Vendedor,
 * 2=Comprador, 3=Imóvel, 5=Pagamento; em locação 1=Locador, 2=Locatário,
 * 3=Imóvel, 4=Aluguel, 5=Garantia. Com um mapa só, a voz em locação devolvia
 * `{}` em SILÊNCIO — o filtro por `pathScope` zerava (nenhuma spec tem chave
 * `locadores`) e o prompt virava literalmente "Retorne {} — nada a preencher".
 */
const VENDA_STEP_SCHEMA: Record<number, StepSchemaSpec> = {
  1: {
    description: "Dados do vendedor (parte que vende o imóvel)",
    paths: [
      { path: "vendedores.0.nome", hint: "nome completo" },
      { path: "vendedores.0.cpf", hint: "CPF (11 dígitos)" },
      { path: "vendedores.0.rg", hint: "RG" },
      { path: "vendedores.0.data_nascimento", hint: "data de nascimento ISO YYYY-MM-DD" },
      { path: "vendedores.0.nome_mae", hint: "nome da mãe" },
      { path: "vendedores.0.estado_civil", hint: "Solteiro(a)|Casado(a)|Divorciado(a)|Viúvo(a)|União estável" },
      { path: "vendedores.0.profissao", hint: "profissão" },
      { path: "vendedores.0.email", hint: "email" },
      { path: "vendedores.0.mobile_phone", hint: "celular com DDD, só dígitos" },
      { path: "vendedores.0.endereco", hint: "endereço rua" },
      { path: "vendedores.0.numero", hint: "número do endereço" },
      { path: "vendedores.0.bairro", hint: "bairro" },
      { path: "vendedores.0.cidade", hint: "cidade" },
      { path: "vendedores.0.uf", hint: "UF (2 letras maiúsculas)" },
      { path: "vendedores.0.cep", hint: "CEP" },
    ],
  },
  2: {
    description: "Dados do comprador (parte que compra o imóvel)",
    paths: [
      { path: "compradores.0.nome", hint: "nome completo" },
      { path: "compradores.0.cpf", hint: "CPF (11 dígitos)" },
      { path: "compradores.0.rg", hint: "RG" },
      { path: "compradores.0.data_nascimento", hint: "data de nascimento ISO YYYY-MM-DD" },
      { path: "compradores.0.nome_mae", hint: "nome da mãe" },
      { path: "compradores.0.estado_civil", hint: "Solteiro(a)|Casado(a)|Divorciado(a)|Viúvo(a)|União estável" },
      { path: "compradores.0.profissao", hint: "profissão" },
      { path: "compradores.0.email", hint: "email" },
      { path: "compradores.0.mobile_phone", hint: "celular com DDD, só dígitos" },
      { path: "compradores.0.endereco", hint: "endereço rua" },
      { path: "compradores.0.numero", hint: "número do endereço" },
      { path: "compradores.0.bairro", hint: "bairro" },
      { path: "compradores.0.cidade", hint: "cidade" },
      { path: "compradores.0.uf", hint: "UF (2 letras maiúsculas)" },
      { path: "compradores.0.cep", hint: "CEP" },
    ],
  },
  3: {
    description: "Dados do imóvel",
    paths: [
      { path: "imoveis.0.rua", hint: "rua/avenida" },
      { path: "imoveis.0.numero", hint: "número" },
      { path: "imoveis.0.complemento", hint: "complemento (apto, bloco)" },
      { path: "imoveis.0.bairro", hint: "bairro" },
      { path: "imoveis.0.cidade", hint: "cidade" },
      { path: "imoveis.0.uf", hint: "UF" },
      { path: "imoveis.0.cep", hint: "CEP" },
      { path: "imoveis.0.matricula", hint: "número da matrícula" },
      { path: "imoveis.0.cartorio", hint: "cartório de registro" },
      { path: "imoveis.0.descricao", hint: "descrição do imóvel" },
    ],
  },
  5: {
    description: "Valores de pagamento",
    paths: [
      { path: "modalidade", hint: 'modalidade: "a_vista" ou "financiamento"' },
      { path: "pagamento.valor_total", hint: "valor total em reais (number, sem ponto)" },
      { path: "pagamento.sinal_arras", hint: "sinal/arras em reais" },
      { path: "pagamento.fgts", hint: "valor do FGTS em reais" },
      { path: "pagamento.alienacao_fiduciaria", hint: "valor financiado em reais" },
    ],
  },
};

const LOCACAO_STEP_SCHEMA: Record<number, StepSchemaSpec> = {
  1: {
    description: "Dados do locador (proprietário que aluga o imóvel)",
    paths: [
      { path: "locadores.0.nome", hint: "nome completo" },
      { path: "locadores.0.cpf", hint: "CPF (11 dígitos)" },
      { path: "locadores.0.rg", hint: "RG" },
      { path: "locadores.0.data_nascimento", hint: "data de nascimento ISO YYYY-MM-DD" },
      { path: "locadores.0.nacionalidade", hint: "nacionalidade" },
      { path: "locadores.0.estado_civil", hint: "Solteiro(a)|Casado(a)|Divorciado(a)|Viúvo(a)|União Estável" },
      { path: "locadores.0.profissao", hint: "profissão" },
      { path: "locadores.0.email", hint: "email" },
      { path: "locadores.0.mobile_phone", hint: "celular com DDD, só dígitos" },
      { path: "locadores.0.endereco", hint: "endereço rua" },
      { path: "locadores.0.numero", hint: "número do endereço" },
      { path: "locadores.0.bairro", hint: "bairro" },
      { path: "locadores.0.cidade", hint: "cidade" },
      { path: "locadores.0.uf", hint: "UF (2 letras maiúsculas)" },
      { path: "locadores.0.cep", hint: "CEP" },
    ],
  },
  2: {
    description: "Dados do locatário (inquilino)",
    paths: [
      { path: "locatarios.0.nome", hint: "nome completo" },
      { path: "locatarios.0.cpf", hint: "CPF (11 dígitos)" },
      { path: "locatarios.0.rg", hint: "RG" },
      { path: "locatarios.0.data_nascimento", hint: "data de nascimento ISO YYYY-MM-DD" },
      { path: "locatarios.0.nacionalidade", hint: "nacionalidade" },
      { path: "locatarios.0.estado_civil", hint: "Solteiro(a)|Casado(a)|Divorciado(a)|Viúvo(a)|União Estável" },
      { path: "locatarios.0.profissao", hint: "profissão" },
      { path: "locatarios.0.email", hint: "email" },
      { path: "locatarios.0.mobile_phone", hint: "celular com DDD, só dígitos" },
      { path: "locatarios.0.endereco", hint: "endereço rua" },
      { path: "locatarios.0.numero", hint: "número do endereço" },
      { path: "locatarios.0.bairro", hint: "bairro" },
      { path: "locatarios.0.cidade", hint: "cidade" },
      { path: "locatarios.0.uf", hint: "UF (2 letras maiúsculas)" },
      { path: "locatarios.0.cep", hint: "CEP" },
      { path: "locatarios.0.renda_mensal", hint: "renda mensal declarada em reais (number)" },
    ],
  },
  3: {
    description: "Dados do imóvel alugado (UM imóvel por contrato)",
    paths: [
      { path: "imovel.rua", hint: "rua/avenida" },
      { path: "imovel.numero", hint: "número" },
      { path: "imovel.complemento", hint: "complemento (apto, bloco)" },
      { path: "imovel.bairro", hint: "bairro" },
      { path: "imovel.cidade", hint: "cidade" },
      { path: "imovel.uf", hint: "UF" },
      { path: "imovel.cep", hint: "CEP" },
      { path: "imovel.matricula", hint: "número da matrícula" },
      { path: "imovel.cartorio", hint: "cartório de registro" },
      { path: "imovel.area", hint: "área em m² (number)" },
      { path: "imovel.vagas_garagem", hint: "número de vagas de garagem (number inteiro)" },
      { path: "imovel.condominio_nome", hint: "nome do condomínio/edifício" },
      { path: "imovel.descricao", hint: "descrição do imóvel" },
    ],
  },
  4: {
    description: "Aluguel, encargos e reajuste",
    paths: [
      { path: "aluguel.valor", hint: "valor do aluguel em reais (number, 2500 = R$ 2.500,00)" },
      { path: "aluguel.condominio_mensal", hint: "condomínio mensal em reais" },
      { path: "aluguel.iptu_mensal", hint: "IPTU mensal em reais" },
      { path: "aluguel.outros_encargos", hint: "outros encargos mensais em reais" },
      { path: "aluguel.dia_vencimento", hint: "dia do vencimento (number 1-28)" },
      { path: "aluguel.indice_reajuste", hint: 'índice: "IGPM", "IPCA" ou "outro"' },
      { path: "aluguel.vigencia_inicio", hint: "início da vigência ISO YYYY-MM-DD" },
      { path: "aluguel.vigencia_meses", hint: "prazo em meses (number)" },
    ],
  },
  5: {
    description: "Garantia locatícia",
    paths: [
      {
        path: "garantia.tipo",
        hint: 'modalidade: "caucao", "fiador", "seguro_fianca", "garantia_onerosa", "titulo_capitalizacao", "propria" ou "sem_garantia"',
      },
      { path: "garantia.caucao_meses", hint: "nº de aluguéis de caução (number, máx 3)" },
      { path: "garantia.fiador.nome", hint: "nome completo do fiador" },
      { path: "garantia.fiador.cpf", hint: "CPF do fiador (11 dígitos)" },
      { path: "garantia.fiador.email", hint: "email do fiador" },
      { path: "garantia.fiador.mobile_phone", hint: "celular do fiador, só dígitos" },
      { path: "garantia.fiador.estado_civil", hint: "estado civil do fiador" },
      { path: "garantia.fiador.conjuge.nome", hint: "nome completo do cônjuge do fiador" },
      { path: "garantia.fiador.conjuge.cpf", hint: "CPF do cônjuge do fiador (11 dígitos)" },
      { path: "observacoes", hint: "observações gerais sobre a negociação" },
    ],
  },
};

const STEP_SCHEMA_BY_ESTEIRA: Record<VoiceEsteira, Record<number, StepSchemaSpec>> = {
  venda: VENDA_STEP_SCHEMA,
  locacao: LOCACAO_STEP_SCHEMA,
};

/** Exportado só para teste: garante que as duas esteiras não colidam. */
export const __STEP_SCHEMA_BY_ESTEIRA = STEP_SCHEMA_BY_ESTEIRA;

export function buildVoicePrompt(
  stepIndex: number,
  pathScope?: readonly string[],
  esteira: VoiceEsteira = "venda",
): string {
  const spec = STEP_SCHEMA_BY_ESTEIRA[esteira][stepIndex];
  if (!spec) {
    return `Você é um assistente de preenchimento de formulário. Transcreva o áudio e retorne JSON vazio se não houver campos identificáveis.`;
  }

  const allowed = new Set(pathScope ?? []);
  const filteredPaths = pathScope
    ? spec.paths.filter((p) => {
        const top = p.path.split(".")[0];
        return allowed.has(top);
      })
    : spec.paths;

  if (filteredPaths.length === 0) {
    return `Retorne {} — nada a preencher.`;
  }

  const lines = filteredPaths
    .map((p) => `  "${p.path}": ${p.hint}`)
    .join(",\n");

  return `Você é um assistente que extrai dados de formulário a partir de áudio em português brasileiro.

Contexto: ${spec.description}.

Ouça o áudio anexo e retorne APENAS um JSON com os campos mencionados pelo usuário. Use exatamente as chaves abaixo (notação dotada de paths). Omita chaves que NÃO foram ditas no áudio. NÃO invente valores.

Shape esperado:
{
${lines}
}

Regras:
- CPF: 11 dígitos sem máscara.
- CEP: pode manter hífen ou retirar.
- Datas: ISO YYYY-MM-DD.
- UF: 2 letras maiúsculas.
- mobile_phone: 10 ou 11 dígitos com DDD, sem máscara.
- Valores monetários: number em reais (350000 = R$ 350.000,00).
- Estado civil: use EXATAMENTE uma das opções listadas.
- Se o usuário disse uma informação ambígua ou parcial, OMITA — usuário corrige depois.

Retorne SOMENTE o JSON.`;
}

export interface VoiceExtractResult {
  fields: Record<string, unknown>;
  rawText: string;
}

/**
 * Roda Gemini 2.5 Flash sobre o áudio e retorna JSON com paths preenchidos.
 * Best-effort: erros viram `{ fields: {}, rawText: "" }`.
 */
export async function extractFromVoice(
  audioBuffer: Buffer,
  mimeType: string,
  stepIndex: number,
  ctx: VoiceExtractContext,
  pathScope?: readonly string[],
  esteira: VoiceEsteira = "venda",
): Promise<VoiceExtractResult> {
  if (!SUPPORTED_VOICE_MIMES.has(mimeType)) {
    return { fields: {}, rawText: "" };
  }

  const t0 = Date.now();
  const prompt = buildVoicePrompt(stepIndex, pathScope, esteira);

  let text = "";
  let usage:
    | GeminiUsageMetadata
    | undefined;

  try {
    const ai = getGenAI();
    const response = await ai.models.generateContent({
      model: VOICE_MODEL,
      contents: [
        { text: prompt },
        {
          inlineData: {
            mimeType,
            data: audioBuffer.toString("base64"),
          },
        },
      ],
      config: {
        responseMimeType: "application/json",
      },
    });
    text = response.text ?? "{}";
    usage = (
      response as {
        usageMetadata?: GeminiUsageMetadata;
      }
    ).usageMetadata;
  } catch (err) {
    recordAIUsage({
      orgId: ctx.orgId,
      userId: ctx.userId,
      provider: "gemini",
      model: VOICE_MODEL,
      operation: "voice_extract",
      promptTokens: 0,
      latencyMs: Date.now() - t0,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    console.error("[voice-extract] Gemini falhou:", err);
    return { fields: {}, rawText: "" };
  }

  const tok = geminiUsageToTokens(usage, VOICE_MODEL);
  recordAIUsage({
    orgId: ctx.orgId,
    userId: ctx.userId,
    provider: "gemini",
    model: VOICE_MODEL,
    operation: "voice_extract",
    promptTokens: tok.promptTokens,
    completionTokens: tok.completionTokens,
    thoughtsTokens: tok.thoughtsTokens,
    latencyMs: Date.now() - t0,
    success: true,
  });

  return { fields: parseVoiceJson(text, pathScope), rawText: text };
}

/**
 * Parse defensivo: aceita JSON cru (responseMimeType garante) ou texto com
 * markdown fence. Filtra chaves fora do pathScope mesmo se o modelo errar.
 */
export function parseVoiceJson(
  raw: string,
  pathScope?: readonly string[],
): Record<string, unknown> {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};

  const out: Record<string, unknown> = {};
  const allow = pathScope ? new Set(pathScope) : null;
  for (const [path, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value === undefined || value === null || value === "") continue;
    if (allow) {
      const top = path.split(".")[0];
      if (!allow.has(top)) continue;
    }
    out[path] = value;
  }
  return out;
}
