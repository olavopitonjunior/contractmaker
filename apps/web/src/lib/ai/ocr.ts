import { Anthropic } from "@anthropic-ai/sdk";
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
              text: 'Classifique este documento brasileiro. Retorne APENAS uma palavra: "rg", "cpf", "matricula", "iptu", "escritura", "procuracao" ou "outro".',
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
  const valid = ["rg", "cpf", "matricula", "iptu", "escritura", "procuracao", "outro"];
  return valid.includes(text) ? text : "outro";
}

const COMBINED_PROMPT = `Voce e um especialista em documentos brasileiros. Analise o documento anexo e retorne APENAS um JSON valido no formato:
{"tipo": "<categoria>", "campos": { ... }, "confidence": <0-1>}

Categorias validas: "rg", "cpf", "cnh", "matricula", "iptu", "escritura", "procuracao", "comprovante_residencia", "outro".

Campos esperados por categoria:
- rg: nome_completo, rg_numero, orgao_expedidor, data_nascimento (YYYY-MM-DD), naturalidade, filiacao_mae, filiacao_pai
- cpf: nome_completo, cpf_numero (11 digitos), data_nascimento, situacao_cadastral
- cnh: nome_completo, cpf_numero (11 digitos), rg_numero, data_nascimento (YYYY-MM-DD), naturalidade, filiacao_mae, filiacao_pai, categoria, data_emissao, data_validade, registro_cnh
- matricula: matricula_numero, cartorio, endereco_completo, bairro, cidade, uf, cep, proprietario_nome, area_total, onus_existentes, descricao_imovel
- iptu: inscricao_iptu, endereco, bairro, cidade, uf, valor_venal, ano_referencia, debitos_pendentes
- escritura: vendedor_nome, comprador_nome, valor_transacao, data_lavratura, cartorio, endereco_imovel, matricula_referenciada
- procuracao: outorgante_nome, outorgante_cpf, outorgado_nome, outorgado_cpf, poderes_resumo, data_lavratura, prazo_validade
- comprovante_residencia: titular_nome, endereco_completo, bairro, cidade, uf, cep, emissor (ex: concessionaria de energia, agua, telefone)
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
  "outro",
];

const SUPPORTED_OCR_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

export async function classifyAndExtract(
  base64Data: string,
  mimeType: string,
  ctx?: OcrUsageContext
): Promise<ExtractionResult> {
  if (!SUPPORTED_OCR_MIMES.has(mimeType)) {
    throw new Error(`Mime type nao suportado para OCR: ${mimeType}`);
  }

  const model = process.env.GEMINI_OCR_MODEL || "gemini-2.5-flash";
  const ai = getGenAI();
  const t0 = Date.now();
  let response;
  try {
    response = await ai.models.generateContent({
      model,
      contents: [
        { text: COMBINED_PROMPT },
        { inlineData: { mimeType, data: base64Data } },
      ],
    });
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

  const text = response.text ?? "{}";

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

  return {
    documentType: tipo,
    fields: fields as Record<string, string>,
    confidence,
    rawText: text,
  };
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
