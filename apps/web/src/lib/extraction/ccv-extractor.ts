import type { ImportableMime } from "@/lib/google/upload-file-as-gdoc";
import {
  parseExtractionJson,
  runDocExtraction,
  type DocExtractionContext,
} from "./genai-extract";

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
 *
 * O encanamento Gemini (client + usage + parse) vive em `genai-extract.ts`,
 * compartilhado com o extractor de contratos de locação.
 */

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
      "mobile_phone": "...",                  // celular com DDD (apenas dígitos)
      "conjuge": {                            // PF casada/união: extraia SEMPRE que o cônjuge for citado
        "nome": "...", "cpf": "...", "rg": "...",
        "nacionalidade": "...", "profissao": "...",
        "email": "...", "mobile_phone": "...",
        "endereco_igual_ao_titular": true
      },
      "procurador": {                         // PF representada por procurador ("neste ato representado por", procuração)
        "nome": "...", "cpf": "...", "rg": "...",
        "email": "...", "mobile_phone": "..."
      },
      "representante": {                      // PJ: pessoa física que assina pela empresa (sócio/administrador/representante legal)
        "nome": "...", "cpf": "...", "rg": "...",
        "email": "...", "mobile_phone": "...", "cargo": "..."
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
    "quem_paga": "comprador" | "vendedor",
    "quando_paga": "assinatura" | "chaves" | "registro",
    "forma_pagamento_preferida": "pix" | "boleto" | "qualquer",
    "prazo_dias_apos_marco": 0,   // dias úteis após o marco de quando_paga
    "comissionados": [            // SEMPRE preencher quando houver comissão,
      {                           // mesmo que seja UM único item.
        "nome": "...",
        "cpf": "...",             // ou cnpj quando PJ
        "cnpj": "...",
        "tipo_pessoa": "fisica" | "juridica",
        "papel": "imobiliaria_principal" | "captador" | "intermediador" | "indicador" | "outro",
        "email": "...",
        "mobile_phone": "...",
        "percentual": 0,          // % da comissão TOTAL (soma <=100 entre todos)
        "valor": 0                // valor absoluto em reais (opcional)
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
- **Comissão**: se o contrato menciona comissão paga a múltiplas pessoas (corretora + intermediária + sub-corretor / co-corretagem captador+intermediador / indicação), liste TODAS em \`comissao.comissionados\` com \`papel\` apropriado (\`captador\` | \`intermediador\` | \`indicador\` | \`imobiliaria_principal\` | \`outro\`) e \`percentual\` da participação na comissão (0-100, soma ≤ 100). Se a comissão é única (uma só pessoa/empresa), AINDA assim preencha \`comissionados\` com 1 item (papel \`imobiliaria_principal\`, percentual 100). Mantenha \`corretora_nome/cpf/cnpj\` por retrocompatibilidade — \`comissionados\` é a fonte canônica.
- **NOME do comissionado é obrigatório sempre que possível**: a tabela/cláusula de RATEIO da comissão costuma listar só valores/percentuais e o CPF/CNPJ, com o NOME (ou razão social) da corretora/pessoa qualificado em OUTRA parte do documento (preâmbulo, cláusula de intermediação, assinaturas, "com a intermediação de..."). Para CADA comissionado, CORRELACIONE a entrada do rateio com essa qualificação e preencha \`nome\` (PF) ou a razão social em \`nome\` (PJ). Só deixe o nome ausente se ele realmente NÃO constar em lugar nenhum do documento. Nunca preencha \`nome\` com o CPF/CNPJ — estes vão em \`cpf\`/\`cnpj\`. Defina \`tipo_pessoa\` por coerência (CNPJ ⇒ juridica; CPF ⇒ fisica).
- **quando_paga**: \`assinatura\` quando comissão paga junto com sinal/ato; \`chaves\` quando paga na entrega da posse; \`registro\` quando paga após registro/escritura (típico em financiamento).
- **forma_pagamento_preferida**: extrair do contrato apenas se houver menção explícita ("via PIX", "boleto bancário"). Caso contrário use \`qualquer\`.
- **prazo_dias_apos_marco**: se contrato disser "até X dias após [assinatura|chaves|registro]", extrair X. Caso contrário omita.
- **mobile_phone**: 10 ou 11 dígitos com DDD, sem máscara (ex: 11987654321).
- **conjuge**: extraia SEMPRE que a parte PF for casada/união estável E o cônjuge for citado/qualificado no contrato (nome, CPF, etc.). É comum o cônjuge assinar como anuente.
- **procurador**: quando o contrato disser que a parte PF é "neste ato representada por", "por seu procurador", ou houver menção a procuração/instrumento de mandato, extraia o procurador (nome/CPF/e-mail).
- **representante** (PJ): quando a parte for pessoa jurídica, extraia a pessoa física que a representa/assina (sócio, administrador, representante legal) com nome/CPF — é ela quem firma o contrato pela empresa.
- NÃO invente dados. Se algo é ilegível ou ausente, omita.

Retorne APENAS o JSON.`;

export type CcvExtractionContext = DocExtractionContext;

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
  return runDocExtraction({
    buffer,
    sourceMime,
    prompt: CCV_EXTRACTION_PROMPT,
    operation: "extract_ccv_doc",
    ctx,
  });
}

/** Alias mantido pros consumidores existentes (testes/locação). */
export const parseCcvJson = parseExtractionJson;
