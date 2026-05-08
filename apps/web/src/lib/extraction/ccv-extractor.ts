import { GoogleGenAI } from "@google/genai";
import { recordAIUsage } from "@/lib/ai/usage";
import type { ImportableMime } from "@/lib/google/upload-file-as-gdoc";

/**
 * Extrai um JSON parcial no shape de `DadosContratoForm` (lib/forms/validation.ts)
 * a partir de um CCV em PDF/DOCX. Usado pelo fluxo de cadastro rápido com upload:
 * o arquivo bruto é enviado direto para o Gemini junto com este prompt; o JSON
 * resultante popula `SalesForm.dataJson` pra que a aba "Dados" do DealDetail
 * mostre os dados extraídos sem o usuário ter que digitar.
 *
 * Por que best-effort: extrair contrato é frágil (formatos variam por escritório).
 * Quando falha, devolvemos `{}` e o usuário edita manualmente — o GDoc com o
 * documento original ainda foi criado, então o fluxo principal não trava.
 */

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

const CCV_EXTRACTION_PROMPT = `Você é especialista em contratos imobiliários brasileiros (CCV — Compromisso de Compra e Venda).

Analise o documento anexo e extraia os dados em JSON ESTRITO no shape abaixo. Retorne APENAS o JSON, sem comentários nem markdown.

{
  "modalidade": "a_vista" | "financiamento",
  "vendedores": [
    {
      "tipo_pessoa": "fisica" | "juridica",
      "nome": "...",                          // PF: nome completo
      "razao_social": "...",                  // PJ: razão social
      "cpf": "11 dígitos sem máscara",        // PF
      "cnpj": "14 dígitos sem máscara",       // PJ
      "rg": "...",
      "estado_civil": "Solteiro(a) | Casado(a) | Divorciado(a) | Viúvo(a) | União estável",
      "regime_bens": "Comunhão parcial | Comunhão universal | Separação total | ...",
      "profissao": "...",
      "nacionalidade": "Brasileiro(a) | ...",
      "data_nascimento": "YYYY-MM-DD",
      "nome_mae": "...",
      "endereco": "...", "numero": "...", "complemento": "...",
      "bairro": "...", "cidade": "...", "uf": "SP", "cep": "00000-000",
      "email": "...",
      "conjuge": {
        "nome": "...", "cpf": "...", "rg": "...",
        "nacionalidade": "...", "profissao": "...",
        "endereco_igual_ao_titular": true
      }
    }
  ],
  "compradores": [ /* mesmo shape de vendedores */ ],
  "imoveis": [
    {
      "rua": "...", "numero": "...", "complemento": "...",
      "bairro": "...", "cidade": "...", "uf": "...", "cep": "...",
      "matricula": "...",         // número
      "cartorio": "...",
      "inscricao_iptu": "...",
      "inscricao_municipal": "...",
      "sql": "Setor.Quadra.Lote",
      "descricao": "..."
    }
  ],
  "pagamento": {
    "valor_total": 0,             // em reais (number)
    "sinal": 0,
    "sinal_data": "YYYY-MM-DD",   // data do sinal/arras quando explícita
    "alienacao_fiduciaria": 0,    // valor financiado
    "fgts": 0,
    "cessao_consorcio": 0,
    "parcelas": [
      { "numero": 1, "valor": 0, "vencimento": "YYYY-MM-DD", "descricao": "..." }
    ]
  },
  "comissao": {
    "corretora_tipo_pessoa": "fisica" | "juridica",
    "corretora_nome": "...",
    "corretora_cpf": "...",       // se PF
    "corretora_cnpj": "...",      // se PJ
    "valor": 0,
    "percentual": 0,
    "comissionados": [            // SEMPRE preencher quando houver comissão,
      {                           // mesmo que seja UM único item.
        "nome": "...",
        "cpf": "...",             // ou cnpj quando PJ
        "cnpj": "...",
        "tipo_pessoa": "fisica" | "juridica",
        "percentual": 0,          // % do valor total
        "valor": 0                // valor absoluto em reais
      }
    ]
  }
}

Regras:
- modalidade = "financiamento" se houver QUALQUER menção a financiamento bancário, FGTS ou cessão de consórcio. Caso contrário "a_vista".
- CPF: 11 dígitos sem pontos/traços. CNPJ: 14 dígitos sem máscara. CEP: pode manter o hífen ou retirar (ambos OK).
- Datas: ISO YYYY-MM-DD.
- Valores monetários: number em reais (ex: 350000 para R$ 350.000,00). Não use string.
- Campos não encontrados: OMITA da resposta (não preencha com null nem string vazia).
- Vendedor PJ: use "razao_social" + "cnpj" (não "nome"+"cpf").
- Se houver múltiplos vendedores/compradores/imóveis, retorne array com TODOS.
- **Parcelas**: SEMPRE preencher \`pagamento.parcelas\` quando o contrato listar parcelamentos explícitos (ex: "1ª parcela de R$ X em DD/MM, 2ª parcela..."), NÃO omita. Numere sequencialmente a partir de 1.
- **Comissão**: se o contrato menciona comissão paga a múltiplas pessoas (corretora + intermediária + sub-corretor), liste TODAS em \`comissao.comissionados\`. Se a comissão é única (uma só pessoa/empresa), AINDA assim preencha \`comissionados\` com 1 item. Mantenha \`corretora_nome/cpf/cnpj\` apenas pelo retrocompatibilidade — \`comissionados\` é a fonte canônica.
- NÃO invente dados. Se algo é ilegível ou ausente, omita.

Retorne APENAS o JSON.`;

const SUPPORTED_MIMES: ImportableMime[] = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export interface CcvExtractionContext {
  orgId: string;
  userId?: string | null;
  contractId?: string | null;
}

/**
 * Roda Gemini 2.5 Flash sobre o CCV e retorna o JSON parsed em shape parcial
 * de DadosContratoForm. Best-effort: erros de rede, parse e safety viram `{}`.
 *
 * O caller deve esperar campos opcionais por toda parte — o usuário vai
 * completar via aba "Dados" do DealDetail.
 */
export async function extractCcvDataJson(
  buffer: Buffer,
  sourceMime: ImportableMime,
  ctx: CcvExtractionContext
): Promise<Record<string, unknown>> {
  if (!SUPPORTED_MIMES.includes(sourceMime)) {
    return {};
  }

  const model = process.env.CCV_EXTRACTION_MODEL || "gemini-2.5-flash";
  const t0 = Date.now();

  let text: string;
  let usage: { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;

  try {
    const ai = getGenAI();
    const response = await ai.models.generateContent({
      model,
      contents: [
        { text: CCV_EXTRACTION_PROMPT },
        {
          inlineData: {
            mimeType: sourceMime,
            data: buffer.toString("base64"),
          },
        },
      ],
    });
    text = response.text ?? "{}";
    usage = (response as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }).usageMetadata;
  } catch (err) {
    recordAIUsage({
      orgId: ctx.orgId,
      userId: ctx.userId,
      contractId: ctx.contractId,
      provider: "gemini",
      model,
      operation: "extract_ccv_doc",
      promptTokens: 0,
      latencyMs: Date.now() - t0,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    console.error("[ccv-extractor] Gemini falhou:", err);
    return {};
  }

  recordAIUsage({
    orgId: ctx.orgId,
    userId: ctx.userId,
    contractId: ctx.contractId,
    provider: "gemini",
    model,
    operation: "extract_ccv_doc",
    promptTokens: usage?.promptTokenCount ?? 0,
    completionTokens: usage?.candidatesTokenCount ?? 0,
    latencyMs: Date.now() - t0,
    success: true,
  });

  return parseCcvJson(text);
}

/** Tenta parsear o JSON retornado pelo Gemini. Defensivo contra markdown wrap. */
export function parseCcvJson(raw: string): Record<string, unknown> {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[0]);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
