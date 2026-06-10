import type { ImportableMime } from "@/lib/google/upload-file-as-gdoc";
import {
  runDocExtraction,
  type DocExtractionContext,
} from "./genai-extract";

/**
 * Extrai um JSON parcial no shape de `dadosLocacaoSchema`
 * (lib/forms/validation-locacao.ts) a partir de um contrato ou proposta de
 * locação em PDF/DOCX. Usado pelos fluxos de entrada de locação: cadastro com
 * proposta (form pré-preenchido) e cadastro rápido com upload (contrato pronto
 * → editor). Best-effort como o CCV de venda: falha vira `{}`.
 *
 * Campo extra `finalidade` ("residencial" | "comercial") fica FORA do schema —
 * o caller usa pra escolher o schemaType e deve removê-lo antes de gravar.
 */

const LOCACAO_EXTRACTION_PROMPT = `Você é especialista em contratos de locação de imóveis brasileiros (Lei 8.245/91).

Analise o documento anexo (contrato de locação ou proposta) e extraia os dados em JSON ESTRITO no shape abaixo. Retorne APENAS o JSON, sem comentários nem markdown.

{
  "finalidade": "residencial" | "comercial",
  "locadores": [
    {
      "tipo_pessoa": "fisica" | "juridica",
      "nome": "...",                          // PF: nome completo
      "razao_social": "...",                  // PJ: razão social
      "cpf": "11 dígitos sem máscara",        // PF
      "cnpj": "14 dígitos sem máscara",       // PJ
      "rg": "...",
      "estado_civil": "Solteiro(a) | Casado(a) | Divorciado(a) | Viúvo(a) | União estável",
      "profissao": "...",
      "nacionalidade": "Brasileiro(a) | ...",
      "data_nascimento": "YYYY-MM-DD",
      "endereco": "...", "numero": "...", "complemento": "...",
      "bairro": "...", "cidade": "...", "uf": "SP", "cep": "00000-000",
      "email": "...",
      "mobile_phone": "...",                  // celular com DDD (apenas dígitos)
      "representante": {                      // só PJ
        "nome": "...", "cpf": "...", "email": "...", "mobile_phone": "..."
      }
    }
  ],
  "locatarios": [ /* mesmo shape de locadores; PF pode ter "renda_mensal": 0 */ ],
  "imovel": {
    "kind": "apartamento" | "casa" | "comercial_sala" | "loja" | "galpao" | "terreno" | "temporada",
    "rua": "...", "numero": "...", "complemento": "...",
    "bairro": "...", "cidade": "...", "uf": "...", "cep": "...",
    "matricula": "...",
    "cartorio": "...",
    "inscricao_iptu": "...",
    "area": 0,                    // m² (number)
    "vagas_garagem": 0,
    "condominio_nome": "...",
    "descricao": "...",           // descrição do imóvel como consta no contrato
    "destinacao": "..."           // SÓ comercial: ramo de atividade do ponto
  },
  "aluguel": {
    "valor": 0,                   // aluguel mensal em reais (number)
    "encargos": 0,                // encargos embutidos no boleto (number)
    "dia_vencimento": 10,         // 1-28
    "indice_reajuste": "IGPM" | "IPCA" | "outro",
    "vigencia_inicio": "YYYY-MM-DD",
    "vigencia_meses": 30,
    "meio_pagamento": "pix" | "boleto" | "qualquer",
    "iptu_mensal": 0,
    "condominio_mensal": 0
  },
  "garantia": {
    "tipo": "fiador" | "caucao" | "seguro_fianca" | "garantia_digital" | "titulo_capitalizacao" | "propria" | "sem_garantia",
    "provider": "...",            // seguradora/subscritora quando houver
    "cobertura_meses": 0,
    "caucao_meses": 0,            // nº de aluguéis caucionados
    "titulo_valor": 0,            // título de capitalização: valor nominal
    "fiador": { /* mesmo shape de pessoa de locadores */ }
  },
  "comissao": {
    "taxa_locacao_percent": 0     // taxa de locação (1º aluguel) em %
  },
  "foro": "...",                  // comarca do foro de eleição
  "assinatura": { "cidade": "...", "uf": "...", "data": "YYYY-MM-DD" }
}

Regras:
- finalidade = "comercial" quando o imóvel se destina a atividade comercial/não-residencial (sala comercial, loja, galpão, ponto comercial, ou cláusula de destinação comercial). Caso contrário "residencial".
- CPF: 11 dígitos sem pontos/traços. CNPJ: 14 dígitos sem máscara.
- Datas: ISO YYYY-MM-DD.
- Valores monetários e área: number (ex: 2500 para R$ 2.500,00). Não use string.
- Campos não encontrados: OMITA da resposta (não preencha com null nem string vazia).
- Parte PJ: use "razao_social" + "cnpj" (não "nome"+"cpf") e preencha "representante" quando o contrato nomear quem assina pela empresa.
- Se houver múltiplos locadores/locatários, retorne array com TODOS. "imovel" é UM objeto (o imóvel locado), não array.
- "garantia.fiador": preencher apenas quando tipo = "fiador" e o contrato qualificar o fiador.
- "vigencia_meses": calcular pela vigência declarada (ex: "30 meses", ou início/fim explícitos).
- "dia_vencimento": dia do mês do pagamento do aluguel (1-28).
- "encargos"/"iptu_mensal"/"condominio_mensal": só quando o contrato disser que são pagos junto com o aluguel/no mesmo boleto.
- "taxa_locacao_percent": só se o documento mencionar a comissão/taxa de locação da imobiliária.
- NÃO invente dados. Se algo é ilegível ou ausente, omita.

Retorne APENAS o JSON.`;

export type LocacaoExtractionContext = DocExtractionContext;

export interface LocacaoExtractionResult {
  /** Parcial de dadosLocacaoSchema, pronto pra virar SalesForm.dataJson. */
  dataJson: Record<string, unknown>;
  /** Heurística do Gemini pra escolher o schemaType. Default residencial. */
  finalidade: "residencial" | "comercial";
}

/**
 * Roda Gemini sobre o contrato/proposta de locação. Best-effort: erros viram
 * `{ dataJson: {}, finalidade: "residencial" }` e o usuário completa à mão.
 */
export async function extractLocacaoContractDataJson(
  buffer: Buffer,
  sourceMime: ImportableMime,
  ctx: LocacaoExtractionContext
): Promise<LocacaoExtractionResult> {
  const raw = await runDocExtraction({
    buffer,
    sourceMime,
    prompt: LOCACAO_EXTRACTION_PROMPT,
    operation: "extract_locacao_doc",
    ctx,
  });
  return splitFinalidade(raw);
}

/** Separa o discriminador `finalidade` do dataJson persistível. */
export function splitFinalidade(
  raw: Record<string, unknown>
): LocacaoExtractionResult {
  const { finalidade, ...dataJson } = raw;
  return {
    dataJson,
    finalidade: finalidade === "comercial" ? "comercial" : "residencial",
  };
}
