import { Anthropic } from "@anthropic-ai/sdk";
import type { ExtractionResult } from "./types";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
  mimeType: string
): Promise<string> {
  const response = await anthropic.messages.create({
    model: process.env.OCR_MODEL || "claude-haiku-4-5-20251001",
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

  const text = response.content[0].type === "text" ? response.content[0].text.trim().toLowerCase() : "outro";
  const valid = ["rg", "cpf", "matricula", "iptu", "escritura", "procuracao", "outro"];
  return valid.includes(text) ? text : "outro";
}

export async function extractDocumentData(
  imageBase64: string,
  mimeType: string,
  category?: string
): Promise<ExtractionResult> {
  // Step 1: Classify if not provided
  const docType = category || await classifyDocument(imageBase64, mimeType);

  // Step 2: Extract with specific prompt
  const prompt = EXTRACTION_PROMPTS[docType] || EXTRACTION_PROMPTS.outro;

  const response = await anthropic.messages.create({
    model: process.env.OCR_MODEL || "claude-haiku-4-5-20251001",
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
