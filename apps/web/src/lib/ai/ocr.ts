import { Anthropic } from "@anthropic-ai/sdk";
import { ocrModelFromEnv } from "./agents/model-provenance";
import { GoogleGenAI } from "@google/genai";
import type { ExtractionResult } from "./types";
import { recordAIUsage } from "./usage";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Optional observability context threaded through OCR calls. When provided,
 * the call is recorded in AIUsage; when absent, the call runs without logging.
 */
export interface OcrUsageContext {
  orgId: string;
  userId?: string | null;
  contractId?: string | null;
}

let genaiClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI {
  if (!genaiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY nao configurada");
    }
    genaiClient = new GoogleGenAI({ apiKey });
  }
  return genaiClient;
}

/**
 * Phase F.IV — humaniza erro do pipeline OCR sem duplicar prefixo.
 * Shared entre single e batch extract routes. Evita "Falha na extração:
 * Falha na extração: }" bug identificado no QA.
 */
export function humanizeOcrError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("safety") || lower.includes("blocked")) {
    return "O documento foi bloqueado pelo filtro de segurança do OCR. Tente um arquivo diferente.";
  }
  if (lower.includes("invalid image") || lower.includes("unsupported") || lower.includes("decode")) {
    return "Não foi possível ler o arquivo. Verifique se é uma imagem nítida ou um PDF de texto.";
  }
  if (lower.includes("timeout") || lower.includes("deadline")) {
    return "A extração demorou demais. Tente um arquivo menor ou clique em Tentar novamente.";
  }
  if (lower.includes("quota") || lower.includes("rate")) {
    return "Limite de uso da IA atingido temporariamente. Aguarde um minuto e tente novamente.";
  }
  if (lower.includes("500") || lower.includes("internal")) {
    return "O serviço de OCR retornou um erro interno para este arquivo. Tente outro formato ou outro documento.";
  }
  const clean = raw.replace(/\{[^}]*\}/g, "").replace(/\s+/g, " ").trim();
  if (!clean || clean.length >= 200) {
    return "Falha na extração. Tente novamente ou use outro arquivo.";
  }
  // Fix duplicação: se raw já começa com "Falha na extra", não prefixar de novo
  if (/^Falha na extra/i.test(clean)) return clean;
  return `Falha na extração: ${clean}`;
}

export function isRateLimitError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("quota") ||
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("too many requests") ||
    lower.includes(" 429") ||
    lower.includes("resource_exhausted")
  );
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const BATCH_MAX_RETRIES = 3;

const EXTRACTION_PROMPTS: Record<string, string> = {
  rg: `Extraia os seguintes dados desta imagem de RG (Registro Geral) brasileiro:
- nome_completo
- rg_numero
- data_nascimento (formato YYYY-MM-DD)
- naturalidade
- filiacao_mae
- filiacao_pai
Retorne APENAS um JSON valido com estes campos. Se algum campo nao for legivel, use null.`,

  cpf: `Extraia os seguintes dados deste documento de CPF brasileiro:
- nome_completo
- cpf_numero (apenas digitos, 11 caracteres)
- data_nascimento (formato YYYY-MM-DD)
- situacao_cadastral
Retorne APENAS um JSON valido.`,

  matricula: `Extraia os seguintes dados desta matrícula de imóvel brasileiro:
- matricula_numero
- cartorio
- endereco_completo
- bairro
- cidade
- uf
- cep
- proprietario_nome
- area_total
- onus_existentes (lista de ônus/gravames)
- descricao_imovel
Retorne APENAS um JSON valido.`,

  iptu: `Extraia os seguintes dados deste carnê/certidão de IPTU:
- inscricao_iptu
- endereco
- bairro
- cidade
- uf
- valor_venal
- ano_referencia
- debitos_pendentes (valor total se houver)
Retorne APENAS um JSON valido.`,

  escritura: `Extraia os seguintes dados desta escritura/título de propriedade:
- vendedor_nome
- comprador_nome
- valor_transacao
- data_lavratura
- cartorio
- endereco_imovel
- matricula_referenciada
Retorne APENAS um JSON valido.`,

  procuracao: `Extraia os seguintes dados desta procuração:
- outorgante_nome (quem deu a procuração)
- outorgante_cpf
- outorgado_nome (quem recebeu)
- outorgado_cpf
- poderes_resumo
- data_lavratura
- prazo_validade
Retorne APENAS um JSON valido.`,

  // F4 iteração 2026-05-17 — certidões anexadas manualmente (sem dispatch
  // Infosimples). Campos análogos ao normalizer Infosimples pra alimentar
  // cross_check_certidoes via CertidaoJobLite sintético.
  certidao_civel: `Extraia os seguintes dados desta certidão cível (TJSP/TJRJ/outro tribunal estadual):
- numero_certidao
- tribunal (ex: "TJSP", "TJRJ")
- cidade
- uf
- nome_consultado
- cpf_cnpj_consultado
- situacao ("negativa" se "nada consta", "positiva" se há ações em curso, "positiva_com_efeitos" se há condenações)
- tem_acao_em_curso (true/false)
- detalhes_acoes (resumo curto se positiva, "" se negativa)
- data_emissao (formato YYYY-MM-DD)
- validade_ate (formato YYYY-MM-DD)
Retorne APENAS um JSON valido.`,

  certidao_trabalhista: `Extraia os seguintes dados desta certidão trabalhista (CNDT, TRT, CEAT):
- numero_certidao
- tribunal (ex: "TST/CNDT", "TRT2", "TRT15")
- nome_consultado
- cpf_cnpj_consultado
- situacao ("negativa" ou "positiva")
- tem_pendencia (true/false)
- detalhes (resumo da pendência se positiva)
- data_emissao (YYYY-MM-DD)
- validade_ate (YYYY-MM-DD, geralmente 180 dias)
Retorne APENAS um JSON valido.`,

  certidao_fiscal: `Extraia os seguintes dados desta certidão fiscal (CND federal, PGFN, Receita Federal, SEFAZ estadual):
- numero_certidao
- orgao_emissor (ex: "PGFN/Receita Federal", "SEFAZ-SP")
- nome_consultado
- cpf_cnpj_consultado
- situacao ("negativa" sem débitos, "positiva_com_efeitos" com débitos parcelados/suspensos, "positiva" com débitos pendentes)
- valor_debito_total (R$, se houver)
- detalhes_debitos (lista curta)
- data_emissao (YYYY-MM-DD)
- validade_ate (YYYY-MM-DD, geralmente 180 dias)
Retorne APENAS um JSON valido.`,

  certidao_protesto: `Extraia os seguintes dados desta certidão de protesto (CENPROT SP/nacional, cartório de protesto):
- numero_certidao
- cartorio_emissor
- nome_consultado
- cpf_cnpj_consultado
- situacao ("negativa" se nada consta, "positiva" se há protesto registrado)
- tem_protesto (true/false)
- valor_protesto_total (se positiva)
- quantidade_protestos
- detalhes (lista de protestos com data/valor/cartório)
- data_emissao (YYYY-MM-DD)
Retorne APENAS um JSON valido.`,

  certidao_iptu: `Extraia os seguintes dados desta certidão negativa/positiva de IPTU municipal:
- numero_certidao
- prefeitura (ex: "São Paulo/SP", "Rio de Janeiro/RJ")
- inscricao_imobiliaria
- endereco_imovel
- situacao ("negativa" sem débitos, "positiva" com débitos)
- valor_debito_iptu (R$, se houver)
- exercicios_em_aberto (lista de anos com débito)
- data_emissao (YYYY-MM-DD)
- validade_ate (YYYY-MM-DD)
Retorne APENAS um JSON valido.`,

  outro: `Identifique o tipo de documento nesta imagem e extraia todos os dados pessoais e informações relevantes que encontrar (nomes, CPF, CNPJ, endereços, valores, datas). Retorne APENAS um JSON valido com os campos encontrados.`,
};

export async function classifyDocument(
  imageBase64: string,
  mimeType: string,
  ctx?: OcrUsageContext
): Promise<string> {
  const model = process.env.OCR_MODEL || "claude-haiku-4-5-20251001";
  const t0 = Date.now();
  let response;
  try {
    response = await anthropic.messages.create({
      model,
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
                data: imageBase64,
              },
            },
            {
              type: "text",
              text: 'Classifique este documento brasileiro. Retorne APENAS uma palavra entre: "rg", "cpf", "matricula", "iptu", "escritura", "procuracao", "certidao_civel" (Justiça comum estadual/federal, TJ), "certidao_trabalhista" (CNDT, TRT, justiça do trabalho), "certidao_fiscal" (CND federal, PGFN, Receita Federal, SEFAZ), "certidao_protesto" (CENPROT, cartório de protesto), "certidao_iptu" (certidão municipal de IPTU/débitos tributários do imóvel) ou "outro".',
            },
          ],
        },
      ],
    });
  } catch (err) {
    if (ctx) {
      recordAIUsage({
        orgId: ctx.orgId,
        userId: ctx.userId,
        contractId: ctx.contractId,
        provider: "anthropic",
        model,
        operation: "ocr_tool",
        promptTokens: 0,
        latencyMs: Date.now() - t0,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  }

  if (ctx) {
    recordAIUsage({
      orgId: ctx.orgId,
      userId: ctx.userId,
      contractId: ctx.contractId,
      provider: "anthropic",
      model,
      operation: "ocr_tool",
      promptTokens: response.usage?.input_tokens ?? 0,
      completionTokens: response.usage?.output_tokens ?? 0,
      latencyMs: Date.now() - t0,
      success: true,
    });
  }

  const text = response.content[0].type === "text" ? response.content[0].text.trim().toLowerCase() : "outro";
  const valid = [
    "rg",
    "cpf",
    "matricula",
    "iptu",
    "escritura",
    "procuracao",
    "certidao_civel",
    "certidao_trabalhista",
    "certidao_fiscal",
    "certidao_protesto",
    "certidao_iptu",
    "outro",
  ];
  return valid.includes(text) ? text : "outro";
}

const FICHA_RESUMO_INSTRUCTIONS = `- ficha_resumo: documento mestre/dossie/ficha cadastral consolidando dados das partes de um negocio imobiliario. Reconheca pelo formato: tabela ou lista declarando explicitamente o papel de cada pessoa ("Vendedor 1", "Comprador 2", "Conjuge do vendedor", "Representante legal", etc), nomes, CPF/CNPJ, e dados pessoais. NAO confunda com escritura ou procuracao (que descrevem um ato juridico). Estrutura esperada:
  {
    "partes": [
      {
        "papel": "vendedor" | "comprador" | "conjuge_vendedor" | "conjuge_comprador" | "representante_vendedor" | "representante_comprador" | "procurador_vendedor" | "procurador_comprador",
        "indice_referencia": 0 (0 para "Vendedor 1", 1 para "Vendedor 2", etc),
        "nome": "...",
        "cpf": "...11 digitos",
        "rg": "...",
        "data_nascimento": "YYYY-MM-DD",
        "nome_mae": "...",
        "naturalidade": "...",
        "estado_civil": "...",
        "profissao": "...",
        "nacionalidade": "...",
        "email": "...",
        "endereco": "...",
        "numero": "...",
        "complemento": "...",
        "bairro": "...",
        "cidade": "...",
        "uf": "...",
        "cep": "...",
        "cnpj": "...14 digitos (so para PJ)",
        "razao_social": "... (so para PJ)"
      }
    ],
    "imoveis": [
      { "rua": "...", "numero": "...", "bairro": "...", "cidade": "...", "uf": "...", "cep": "...", "matricula": "...", "cartorio": "...", "inscricao_iptu": "...", "inscricao_municipal": "...", "sql": "...", "descricao": "..." }
    ]
  }`;

export const COMBINED_PROMPT = `Voce e um especialista em documentos brasileiros. Analise o documento anexo e retorne APENAS um JSON valido no formato:
{"tipo": "<categoria>", "campos": { ... }, "confidence": <0-1>}

Categorias validas: "rg", "cpf", "cnh", "matricula", "iptu", "escritura", "procuracao", "comprovante_residencia", "certidao_casamento", "ficha_resumo", "outro".

Campos esperados por categoria:
- rg: nome_completo, rg_numero, orgao_expedidor, data_nascimento (YYYY-MM-DD), sexo ("M" ou "F", se aparecer), naturalidade, filiacao_mae, filiacao_pai, conjuge_nome (opcional, se aparecer no documento como qualificacao "casado(a) com X" ou em averbacao), conjuge_cpf (opcional)
- cpf: nome_completo, cpf_numero (11 digitos), data_nascimento, situacao_cadastral
- cnh: nome_completo, cpf_numero (11 digitos), rg_numero, data_nascimento (YYYY-MM-DD), sexo ("M" ou "F", se aparecer), naturalidade, filiacao_mae, filiacao_pai, categoria, data_emissao, data_validade, registro_cnh, conjuge_nome (opcional, se aparecer), conjuge_cpf (opcional)
- matricula: matricula_numero, cartorio, endereco_completo, bairro, cidade, uf, cep, proprietario_nome, area_total, onus_existentes, descricao_imovel
- iptu: inscricao_iptu, inscricao_municipal, sql (Setor-Quadra-Lote, SP), endereco, bairro, cidade, uf, valor_venal, ano_referencia, debitos_pendentes
- escritura: vendedor_nome, comprador_nome, valor_transacao, data_lavratura, cartorio, endereco_imovel, matricula_referenciada
- procuracao: outorgante_nome, outorgante_cpf, outorgado_nome, outorgado_cpf, poderes_resumo, data_lavratura, prazo_validade
- comprovante_residencia: titular_nome, endereco_completo, bairro, cidade, uf, cep, emissor (ex: concessionaria de energia, agua, telefone)
- certidao_casamento: conjuge1_nome, conjuge1_cpf, conjuge2_nome, conjuge2_cpf, data_casamento, regime_bens (literal, ex: "Comunhao parcial de bens"), cartorio, data_lavratura
${FICHA_RESUMO_INSTRUCTIONS}
- outro: inclua todos os dados relevantes encontrados (nomes, cpf, cnpj, enderecos, valores, datas)

Regras:
- Se um campo nao for legivel, use null.
- CPF sempre com 11 digitos, sem pontos ou tracos.
- Datas no formato ISO YYYY-MM-DD.
- Para confidence, estime de 0 a 1 com base em quantos campos voce conseguiu extrair com seguranca.
- NAO inclua explicacoes, apenas o JSON.`;

const VALID_CATEGORIES = [
  "rg",
  "cpf",
  "cnh",
  "matricula",
  "iptu",
  "escritura",
  "procuracao",
  "comprovante_residencia",
  "certidao_casamento",
  "ficha_resumo",
  "outro",
];

const SUPPORTED_OCR_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

/**
 * Pre-validation — catch obvious bad inputs before spending a Gemini call.
 * Returns null if the file looks OK, or a human-friendly error message if
 * it should be rejected.
 */
export function prevalidateForOcr(
  buffer: Buffer,
  mimeType: string
): string | null {
  if (buffer.length === 0) {
    return "Arquivo vazio. Faça o upload novamente.";
  }
  if (buffer.length < 100) {
    return "Arquivo corrompido ou muito pequeno para OCR.";
  }
  if (mimeType === "application/pdf") {
    // PDF files must start with the `%PDF-1.` header (bytes 0x25 0x50 0x44 0x46 0x2D 0x31 0x2E)
    const header = buffer.subarray(0, 7).toString("ascii");
    if (!header.startsWith("%PDF-1.")) {
      return "PDF inválido ou corrompido — header ausente.";
    }
  }
  if (mimeType.startsWith("image/")) {
    // Sanity on size — server-side we can't check dimensions without decoding,
    // but we can reject obviously tiny files which are almost always bad scans.
    if (buffer.length < 2_000) {
      return "Imagem muito pequena para OCR. Use um scan de pelo menos 300 DPI.";
    }
  }
  return null;
}

export const PLAIN_TEXT_PROMPT = `Transcreva o texto deste documento na íntegra, verbatim, preservando a ordem e a estrutura (parágrafos, títulos, cláusulas numeradas). NÃO resuma, NÃO comente, NÃO traduza e NÃO adicione formatação markdown. Retorne apenas o texto extraído.`;

/**
 * Extrai o TEXTO CORRIDO de um PDF ou imagem via Gemini (verbatim, sem resumir).
 * Usado pela ingestão de documentos na base de conhecimento. DOCX é extraído
 * fora daqui (mammoth, lib/extraction/docx.ts) — aqui só PDF/imagem. Requer
 * `GEMINI_API_KEY` (getGenAI lança se ausente).
 */
export async function extractPlainText(
  buffer: Buffer,
  mimeType: string,
  ctx?: OcrUsageContext
): Promise<string> {
  if (!SUPPORTED_OCR_MIMES.has(mimeType)) {
    throw new Error(`Mime type não suportado para extração de texto: ${mimeType}`);
  }
  const prevalidationError = prevalidateForOcr(buffer, mimeType);
  if (prevalidationError) throw new Error(prevalidationError);

  const model = ocrModelFromEnv();
  const ai = getGenAI();
  const t0 = Date.now();
  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        { text: PLAIN_TEXT_PROMPT },
        { inlineData: { mimeType, data: buffer.toString("base64") } },
      ],
    });
    if (ctx) {
      const usage = (response as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }).usageMetadata;
      recordAIUsage({
        orgId: ctx.orgId,
        userId: ctx.userId,
        contractId: ctx.contractId,
        provider: "gemini",
        model,
        operation: "ocr_form",
        promptTokens: usage?.promptTokenCount ?? 0,
        completionTokens: usage?.candidatesTokenCount ?? 0,
        latencyMs: Date.now() - t0,
        success: true,
      });
    }
    return (response.text ?? "").trim();
  } catch (err) {
    if (ctx) {
      recordAIUsage({
        orgId: ctx.orgId,
        userId: ctx.userId,
        contractId: ctx.contractId,
        provider: "gemini",
        model,
        operation: "ocr_form",
        promptTokens: 0,
        latencyMs: Date.now() - t0,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  }
}

/**
 * Extracts a human-readable heuristic to decide if a rate-limit/5xx error
 * should trigger a fallback model retry. Rate limits are handled by the
 * server-side classifyWithRetry; this only detects non-rate-limit errors
 * that benefit from a different model.
 */
function shouldTryFallbackModel(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  // Don't fallback on rate limits (those need backoff, not a different model)
  if (
    msg.includes("quota") ||
    msg.includes("rate limit") ||
    msg.includes("rate_limit") ||
    msg.includes("429") ||
    msg.includes("resource_exhausted")
  ) {
    return false;
  }
  // Fallback on 500s, safety blocks, "content blocked", parse failures
  return (
    msg.includes("500") ||
    msg.includes("internal") ||
    msg.includes("safety") ||
    msg.includes("blocked") ||
    msg.includes("invalid image") ||
    msg.includes("decode")
  );
}

async function callGemini(
  model: string,
  base64Data: string,
  mimeType: string
): Promise<{ text: string; usage: { promptTokenCount?: number; candidatesTokenCount?: number } | undefined }> {
  const ai = getGenAI();
  const response = await ai.models.generateContent({
    model,
    contents: [
      { text: COMBINED_PROMPT },
      { inlineData: { mimeType, data: base64Data } },
    ],
  });
  return {
    text: response.text ?? "{}",
    usage: (response as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }).usageMetadata,
  };
}

/**
 * Phase F.I-β — Fallback de último recurso: Claude Haiku 4.5 vision.
 *
 * Chamado quando Gemini primário E fallback falham (5xx persistente, safety
 * block, quota esgotada mesmo após retries). ~10x mais caro que Flash
 * ($0.003/doc) mas tem uptime independente + limites de rate-limit diferentes.
 *
 * Só suporta imagens (Anthropic vision). PDFs passam como documento.
 */
async function callClaudeHaikuOcr(
  base64Data: string,
  mimeType: string
): Promise<{ text: string; usage: { promptTokenCount?: number; candidatesTokenCount?: number } | undefined }> {
  const model = process.env.OCR_FALLBACK_CLAUDE_MODEL || "claude-haiku-4-5-20251001";
  // PDFs não são suportados pelo fallback Claude (SDK estável só aceita images).
  // Deixa o erro Gemini propagar para PDF — user pode retentar mais tarde.
  if (mimeType === "application/pdf") {
    throw new Error(
      "Claude fallback não suporta PDFs nesta versão do SDK — retente em alguns minutos"
    );
  }
  const response = await anthropic.messages.create({
    model,
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
              data: base64Data,
            },
          },
          { type: "text", text: COMBINED_PROMPT },
        ],
      },
    ],
  });
  const text =
    response.content[0]?.type === "text" ? response.content[0].text : "{}";
  return {
    text,
    usage: {
      promptTokenCount: response.usage.input_tokens,
      candidatesTokenCount: response.usage.output_tokens,
    },
  };
}

function parseGeminiJson(text: string): {
  tipo: string;
  fields: Record<string, unknown>;
  confidence: number;
} {
  let tipo = "outro";
  let fields: Record<string, unknown> = {};
  let confidence = 0;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const rawTipo = typeof parsed.tipo === "string" ? parsed.tipo.trim().toLowerCase() : "outro";
      tipo = VALID_CATEGORIES.includes(rawTipo) ? rawTipo : "outro";
      fields = parsed.campos && typeof parsed.campos === "object" ? parsed.campos : {};
      if (typeof parsed.confidence === "number") {
        confidence = Math.max(0, Math.min(1, parsed.confidence));
      } else {
        const totalFields = Object.keys(fields).length;
        const filled = Object.values(fields).filter((v) => v !== null && v !== "").length;
        confidence = totalFields > 0 ? filled / totalFields : 0;
      }
    }
  } catch {
    fields = { raw_text: text };
  }
  return { tipo, fields, confidence };
}

export interface ClassifyOptions {
  /** If the primary model fails with a non-rate-limit error, try this one */
  fallbackModel?: string;
  /** Skip pre-validation (useful when caller already validated) */
  skipPrevalidation?: boolean;
  /** Raw buffer — required if skipPrevalidation is false */
  buffer?: Buffer;
}

export async function classifyAndExtract(
  base64Data: string,
  mimeType: string,
  ctx?: OcrUsageContext,
  options: ClassifyOptions = {}
): Promise<ExtractionResult> {
  if (!SUPPORTED_OCR_MIMES.has(mimeType)) {
    throw new Error(`Mime type nao suportado para OCR: ${mimeType}`);
  }

  // Pre-validation — reject obviously bad inputs before spending quota
  if (!options.skipPrevalidation && options.buffer) {
    const prevalidationError = prevalidateForOcr(options.buffer, mimeType);
    if (prevalidationError) {
      throw new Error(prevalidationError);
    }
  }

  const primaryModel = ocrModelFromEnv();
  const fallbackModel = options.fallbackModel ?? "gemini-2.5-flash-lite";
  const t0 = Date.now();

  let text: string;
  let usage: { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
  let modelUsed = primaryModel;

  try {
    const result = await callGemini(primaryModel, base64Data, mimeType);
    text = result.text;
    usage = result.usage;
  } catch (primaryErr) {
    // Fallback: try a different model on 5xx / safety / decode errors
    if (fallbackModel && fallbackModel !== primaryModel && shouldTryFallbackModel(primaryErr)) {
      console.warn(
        `[ocr] primary model ${primaryModel} failed (${primaryErr instanceof Error ? primaryErr.message.slice(0, 80) : "?"}), trying fallback ${fallbackModel}`
      );
      try {
        const result = await callGemini(fallbackModel, base64Data, mimeType);
        text = result.text;
        usage = result.usage;
        modelUsed = fallbackModel;
      } catch (fallbackErr) {
        // Phase F.I-β — último recurso: Claude Haiku 4.5 vision.
        // Só vale a pena se erro não é rate-limit (Anthropic tem quota
        // independente de Gemini) E não é safety block específico do
        // conteúdo (filtros geralmente coincidem entre providers).
        const useClaudeFallback = process.env.OCR_CLAUDE_FALLBACK_ENABLED !== "false";
        const fallbackMsg =
          fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        const shouldTryClaude =
          useClaudeFallback &&
          !isRateLimitError(fallbackMsg) &&
          !fallbackMsg.toLowerCase().includes("safety") &&
          !fallbackMsg.toLowerCase().includes("blocked");
        if (shouldTryClaude) {
          console.warn(
            `[ocr] fallback Gemini ${fallbackModel} also failed — trying Claude Haiku as last resort`
          );
          try {
            const result = await callClaudeHaikuOcr(base64Data, mimeType);
            text = result.text;
            usage = result.usage;
            modelUsed = process.env.OCR_FALLBACK_CLAUDE_MODEL || "claude-haiku-4-5-20251001";
            // Importante: modelUsed = claude, provider mudou. recordAIUsage
            // é feito no success path abaixo, mas agora provider é anthropic.
          } catch (claudeErr) {
            if (ctx) {
              recordAIUsage({
                orgId: ctx.orgId,
                userId: ctx.userId,
                contractId: ctx.contractId,
                provider: "anthropic",
                model: process.env.OCR_FALLBACK_CLAUDE_MODEL || "claude-haiku-4-5-20251001",
                operation: "ocr_form",
                promptTokens: 0,
                latencyMs: Date.now() - t0,
                success: false,
                errorMessage: claudeErr instanceof Error ? claudeErr.message : String(claudeErr),
              });
            }
            throw primaryErr; // Propaga o original (mais informativo)
          }
        } else {
          // Both Gemini failed — report the original error
          if (ctx) {
            recordAIUsage({
              orgId: ctx.orgId,
              userId: ctx.userId,
              contractId: ctx.contractId,
              provider: "gemini",
              model: primaryModel,
              operation: "ocr_form",
              promptTokens: 0,
              latencyMs: Date.now() - t0,
              success: false,
              errorMessage: fallbackMsg,
            });
          }
          throw primaryErr;
        }
      }
    } else {
      if (ctx) {
        recordAIUsage({
          orgId: ctx.orgId,
          userId: ctx.userId,
          contractId: ctx.contractId,
          provider: "gemini",
          model: primaryModel,
          operation: "ocr_form",
          promptTokens: 0,
          latencyMs: Date.now() - t0,
          success: false,
          errorMessage: primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
        });
      }
      throw primaryErr;
    }
  }

  if (ctx) {
    // Phase F.I-β — provider correto conforme modelo usado (pode ter
    // caído na cascata Gemini → Claude Haiku).
    const providerUsed = modelUsed.startsWith("claude") ? "anthropic" : "gemini";
    recordAIUsage({
      orgId: ctx.orgId,
      userId: ctx.userId,
      contractId: ctx.contractId,
      provider: providerUsed,
      model: modelUsed,
      operation: "ocr_form",
      promptTokens: usage?.promptTokenCount ?? 0,
      completionTokens: usage?.candidatesTokenCount ?? 0,
      latencyMs: Date.now() - t0,
      success: true,
    });
  }

  const parsed = parseGeminiJson(text);

  return {
    documentType: parsed.tipo,
    fields: parsed.fields as Record<string, string>,
    confidence: parsed.confidence,
    rawText: text,
  };
}

/**
 * Batch OCR — sends up to N documents in a single Gemini call and returns
 * an array of results in the same order. Used by the /batch-extract endpoint
 * to amortize per-request overhead and reduce RPM pressure.
 *
 * Strategy:
 *   - Concatenates all files as separate inlineData parts
 *   - Prompts the model to return a JSON array indexed by position
 *   - On parse failure (or response size mismatch), the caller is expected
 *     to fall back to individual calls via classifyAndExtract
 *
 * Cap: 4 docs per batch (token budget safety margin for 2.5 Flash's 1M context).
 */
export interface BatchItem {
  base64Data: string;
  mimeType: string;
}

export interface BatchResult {
  index: number;
  documentType: string;
  fields: Record<string, string>;
  confidence: number;
  rawText: string;
}

const BATCH_PROMPT = `Voce e um especialista em documentos brasileiros. Analise os DOCUMENTOS abaixo (multiplos arquivos, na ordem em que foram enviados) e retorne APENAS um array JSON valido. Um objeto por documento, preservando a ordem:

[
  {"indice": 0, "tipo": "<categoria>", "campos": { ... }, "confidence": <0-1>},
  {"indice": 1, "tipo": "<categoria>", "campos": { ... }, "confidence": <0-1>},
  ...
]

Categorias validas: "rg", "cpf", "cnh", "matricula", "iptu", "escritura", "procuracao", "comprovante_residencia", "certidao_casamento", "ficha_resumo", "outro".

Use as mesmas regras e campos do prompt single-doc:
- rg: nome_completo, rg_numero, orgao_expedidor, data_nascimento (YYYY-MM-DD), sexo ("M" ou "F", se aparecer), naturalidade, filiacao_mae, filiacao_pai, conjuge_nome (opcional), conjuge_cpf (opcional)
- cpf: nome_completo, cpf_numero (11 digitos), data_nascimento, situacao_cadastral
- cnh: nome_completo, cpf_numero, rg_numero, data_nascimento, sexo ("M" ou "F", se aparecer), naturalidade, filiacao_mae, filiacao_pai, categoria, data_emissao, data_validade, registro_cnh, conjuge_nome (opcional), conjuge_cpf (opcional)
- matricula: matricula_numero, cartorio, endereco_completo, bairro, cidade, uf, cep, proprietario_nome, area_total, onus_existentes, descricao_imovel
- iptu: inscricao_iptu, inscricao_municipal, sql (Setor-Quadra-Lote, SP), endereco, bairro, cidade, uf, valor_venal, ano_referencia, debitos_pendentes
- escritura: vendedor_nome, comprador_nome, valor_transacao, data_lavratura, cartorio, endereco_imovel, matricula_referenciada
- procuracao: outorgante_nome, outorgante_cpf, outorgado_nome, outorgado_cpf, poderes_resumo, data_lavratura, prazo_validade
- comprovante_residencia: titular_nome, endereco_completo, bairro, cidade, uf, cep, emissor
- certidao_casamento: conjuge1_nome, conjuge1_cpf, conjuge2_nome, conjuge2_cpf, data_casamento, regime_bens, cartorio, data_lavratura
${FICHA_RESUMO_INSTRUCTIONS}
- outro: inclua todos os dados relevantes

Regras:
- Campos nao legiveis = null
- CPF = 11 digitos sem pontuacao
- Datas = ISO YYYY-MM-DD
- O ARRAY DEVE TER EXATAMENTE O NUMERO DE OBJETOS QUE O NUMERO DE DOCUMENTOS ENVIADOS
- NAO inclua explicacoes, apenas o JSON array.`;

export async function classifyAndExtractBatch(
  items: BatchItem[],
  ctx?: OcrUsageContext
): Promise<BatchResult[]> {
  if (items.length === 0) return [];
  if (items.length === 1) {
    // Single-item "batch" falls back to the single-call path for simplicity
    const r = await classifyAndExtract(items[0].base64Data, items[0].mimeType, ctx);
    return [
      {
        index: 0,
        documentType: r.documentType,
        fields: r.fields,
        confidence: r.confidence,
        rawText: r.rawText ?? "",
      },
    ];
  }
  if (items.length > 4) {
    throw new Error(
      `Batch máximo é 4 documentos por chamada (recebido ${items.length})`
    );
  }

  const model = ocrModelFromEnv();
  const ai = getGenAI();
  const t0 = Date.now();

  // Build the contents array: prompt + each item as inlineData
  const contents: Array<
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
  > = [{ text: BATCH_PROMPT }];
  for (const item of items) {
    contents.push({
      inlineData: { mimeType: item.mimeType, data: item.base64Data },
    });
  }

  // Retry with exponential backoff on rate-limit errors (429 / quota /
  // resource_exhausted). Non-rate-limit errors fail fast. Matches the retry
  // policy already used by classifyWithRetry() in the single-doc extract route.
  // 3 attempts: 0s, 5s(+jitter), 10s(+jitter) → total worst-case ~15s of wait
  // on top of the actual Gemini latency.
  let response: Awaited<ReturnType<typeof ai.models.generateContent>> | null = null;
  let lastErr: unknown = null;
  let attempt = 0;
  for (attempt = 0; attempt < BATCH_MAX_RETRIES; attempt++) {
    try {
      response = await ai.models.generateContent({ model, contents });
      break;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!isRateLimitError(msg) || attempt === BATCH_MAX_RETRIES - 1) {
        if (ctx) {
          recordAIUsage({
            orgId: ctx.orgId,
            userId: ctx.userId,
            contractId: ctx.contractId,
            provider: "gemini",
            model,
            operation: "ocr_form",
            promptTokens: 0,
            latencyMs: Date.now() - t0,
            success: false,
            errorMessage: msg,
          });
        }
        throw err;
      }
      const base = 5000 * Math.pow(2, attempt);
      const jitter = Math.floor(Math.random() * 2000);
      const waitMs = base + jitter;
      console.warn(
        `[batch OCR] rate limit — retry ${attempt + 1}/${BATCH_MAX_RETRIES} in ${waitMs}ms`
      );
      await sleep(waitMs);
    }
  }
  if (!response) {
    // Unreachable: loop either breaks with a response or throws. Defensive.
    throw lastErr ?? new Error("Batch OCR: no response after retries");
  }

  if (ctx) {
    const usage = (response as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }).usageMetadata;
    recordAIUsage({
      orgId: ctx.orgId,
      userId: ctx.userId,
      contractId: ctx.contractId,
      provider: "gemini",
      model,
      operation: "ocr_form",
      promptTokens: usage?.promptTokenCount ?? 0,
      completionTokens: usage?.candidatesTokenCount ?? 0,
      latencyMs: Date.now() - t0,
      success: true,
    });
  }

  const text = response.text ?? "[]";

  // Extract the JSON array from the response (may be wrapped in text/markdown)
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (!arrayMatch) {
    throw new Error("Batch OCR: resposta não contém array JSON");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(arrayMatch[0]);
  } catch (err) {
    throw new Error(
      `Batch OCR: falha ao parsear JSON array (${err instanceof Error ? err.message : "unknown"})`
    );
  }

  if (!Array.isArray(parsed) || parsed.length !== items.length) {
    throw new Error(
      `Batch OCR: array retornado tem ${Array.isArray(parsed) ? parsed.length : "não-array"} items, esperado ${items.length}`
    );
  }

  return parsed.map((obj, i) => {
    const o = obj as Record<string, unknown>;
    const rawTipo = typeof o.tipo === "string" ? o.tipo.trim().toLowerCase() : "outro";
    const tipo = VALID_CATEGORIES.includes(rawTipo) ? rawTipo : "outro";
    const fields = (o.campos && typeof o.campos === "object" ? o.campos : {}) as Record<string, unknown>;
    let confidence = 0;
    if (typeof o.confidence === "number") {
      confidence = Math.max(0, Math.min(1, o.confidence));
    } else {
      const totalFields = Object.keys(fields).length;
      const filled = Object.values(fields).filter((v) => v !== null && v !== "").length;
      confidence = totalFields > 0 ? filled / totalFields : 0;
    }
    return {
      index: i,
      documentType: tipo,
      fields: fields as Record<string, string>,
      confidence,
      rawText: JSON.stringify(obj),
    };
  });
}

export async function extractDocumentData(
  imageBase64: string,
  mimeType: string,
  category?: string,
  ctx?: OcrUsageContext
): Promise<ExtractionResult> {
  // Step 1: Classify if not provided
  const docType = category || await classifyDocument(imageBase64, mimeType, ctx);

  // Step 2: Extract with specific prompt
  const prompt = EXTRACTION_PROMPTS[docType] || EXTRACTION_PROMPTS.outro;
  const model = process.env.OCR_MODEL || "claude-haiku-4-5-20251001";
  const t0 = Date.now();
  let response;
  try {
    response = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
                data: imageBase64,
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    });
  } catch (err) {
    if (ctx) {
      recordAIUsage({
        orgId: ctx.orgId,
        userId: ctx.userId,
        contractId: ctx.contractId,
        provider: "anthropic",
        model,
        operation: "ocr_tool",
        promptTokens: 0,
        latencyMs: Date.now() - t0,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  }

  if (ctx) {
    recordAIUsage({
      orgId: ctx.orgId,
      userId: ctx.userId,
      contractId: ctx.contractId,
      provider: "anthropic",
      model,
      operation: "ocr_tool",
      promptTokens: response.usage?.input_tokens ?? 0,
      completionTokens: response.usage?.output_tokens ?? 0,
      latencyMs: Date.now() - t0,
      success: true,
    });
  }

  const text = response.content[0].type === "text" ? response.content[0].text : "{}";

  let fields: Record<string, string> = {};
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      fields = JSON.parse(jsonMatch[0]);
    }
  } catch {
    fields = { raw_text: text };
  }

  // Estimate confidence based on number of non-null fields
  const totalFields = Object.keys(fields).length;
  const filledFields = Object.values(fields).filter((v) => v !== null && v !== "").length;
  const confidence = totalFields > 0 ? filledFields / totalFields : 0;

  return {
    documentType: docType,
    fields,
    confidence,
    rawText: text,
  };
}
