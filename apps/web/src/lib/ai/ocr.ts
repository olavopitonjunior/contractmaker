import { Anthropic } from "@anthropic-ai/sdk";
import { ocrModelFromEnv } from "./agents/model-provenance";
import { GoogleGenAI } from "@google/genai";
import type { ExtractionResult } from "./types";
import { recordAIUsage, geminiUsageToTokens, calcCostUsd } from "./usage";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/db/prisma";
import {
  compararSombra,
  shadowModelFromEnv,
  type ComparacaoSombra,
} from "./ocr-shadow";
import type { GeminiUsageMetadata } from "./usage";
import {
  chamarOpenAIOcr,
  isModeloOpenAI,
  schemaJsonDeCampos,
} from "./ocr-openai";

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
  // Credencial primeiro: se a cascata inteira caiu por config, o corretor não
  // tem NADA a fazer com o arquivo dele. Mandá-lo "tentar outro documento" o
  // faz repetir um trabalho que nunca vai funcionar até alguém corrigir uma env
  // var — e ainda esconde o incidente, porque ele culpa o próprio PDF em vez de
  // abrir chamado. Vem antes de "invalid image" porque o detector exige duas
  // metades e não confunde os dois.
  if (isConfigCredentialError(lower)) {
    return "O serviço de extração está temporariamente indisponível por uma configuração do sistema — não é problema do seu arquivo. A equipe técnica já pode ver isso nos logs.";
  }
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

// ────────────────────────────────────────────────────────────────────────────
// Structured output — `responseSchema` do Gemini
// ────────────────────────────────────────────────────────────────────────────

/**
 * Todos os campos planos citados no `COMBINED_PROMPT`, em união.
 *
 * O schema do Gemini não tem `oneOf` utilizável, então `campos` é um SUPERSET:
 * o modelo preenche o que pertence à categoria detectada e devolve `null` no
 * resto. O prompt continua sendo quem explica QUAIS campos pertencem a cada
 * categoria; o schema só garante o formato da saída.
 *
 * **Declarar `properties` não é detalhe.** Medido em 24/08 contra a API: um
 * `campos: { type: "OBJECT" }` sem properties não dá erro — devolve
 * `campos: {}` VAZIO, em silêncio. Ou seja, o OCR pararia de extrair qualquer
 * coisa sem nenhum sintoma no log.
 */
const COMBINED_FIELD_KEYS = [
  // pessoa (rg, cpf, cnh)
  "nome_completo", "rg_numero", "orgao_expedidor", "data_nascimento", "sexo",
  "naturalidade", "filiacao_mae", "filiacao_pai", "conjuge_nome", "conjuge_cpf",
  "cpf_numero", "situacao_cadastral", "categoria", "data_emissao",
  "data_validade", "registro_cnh",
  // matrícula / imóvel
  "matricula_numero", "cartorio", "endereco_completo", "bairro", "cidade", "uf",
  "cep", "proprietario_nome", "area_total", "onus_existentes", "descricao_imovel",
  // iptu
  "inscricao_iptu", "inscricao_municipal", "sql", "endereco", "valor_venal",
  "ano_referencia", "debitos_pendentes",
  // escritura
  "vendedor_nome", "comprador_nome", "valor_transacao", "data_lavratura",
  "endereco_imovel", "matricula_referenciada",
  // procuração
  "outorgante_nome", "outorgante_cpf", "outorgado_nome", "outorgado_cpf",
  "poderes_resumo", "prazo_validade",
  // comprovante de residência
  "titular_nome", "emissor",
  // certidão de casamento
  "conjuge1_nome", "conjuge1_cpf", "conjuge2_nome", "conjuge2_cpf",
  "data_casamento", "regime_bens",
  // `outro` — rótulo livre que o DocumentCard usa como legenda do badge
  "tipo_documento",
  // PJ no nível PLANO. O COMBINED_PROMPT manda, em `outro`, "incluir todos os
  // dados relevantes (nomes, cpf, CNPJ, enderecos...)", mas com schema ligado só
  // volta o que está declarado — e `cnpj`/`razao_social` só existiam aninhados
  // em `partes[]`. Sem isto, cartão CNPJ e contrato social passariam a devolver
  // nada nesses campos justamente quando o schema é ligado.
  "cnpj", "razao_social",
] as const;

/** Campos que o formulário consome como data ISO. Ver `coerce` em lib/forms. */
const DATE_FIELD_KEYS = new Set<string>([
  "data_nascimento", "data_emissao", "data_validade", "data_lavratura",
  "data_casamento",
]);

type SchemaNode = Record<string, unknown>;

/**
 * `nullable: true` em todo campo: sem isso o modelo não tem como dizer "não li"
 * dentro do tipo STRING e devolve a string literal `"null"`, que vazava para o
 * formulário como texto. Medido no `gemma-4-31b-it`.
 */
function stringField(key: string): SchemaNode {
  const node: SchemaNode = { type: "STRING", nullable: true };
  if (DATE_FIELD_KEYS.has(key)) {
    node.description = "Data no formato ISO YYYY-MM-DD. null se ilegivel.";
  }
  const aviso = DESCRICAO_ANTI_VAZAMENTO[key];
  if (aviso) node.description = aviso;
  return node;
}

/**
 * O preço do superset: declarar `cidade`/`uf`/`bairro`/`cep` para TODA
 * categoria convida o modelo a preenchê-los em documento que não tem endereço.
 *
 * O caso concreto: num RG ou CNH, a única cidade impressa é a NATURALIDADE
 * ("Naturalidade: São Paulo-SP"). Mas `cidade` e `uf` mapeiam, em
 * `FIELD_MAP_PERSON`, para a cidade e a UF do ENDEREÇO da pessoa — então o
 * local de nascimento aterrissaria silenciosamente no endereço. O guard de
 * `null` em `applyField` não ajuda: o valor é uma string legítima.
 *
 * Restringir o schema por categoria exigiria um schema por categoria (o que o
 * braço de duas etapas do bench vai avaliar). Enquanto isso, a descrição é o
 * que o modelo lê — e é grátis.
 */
const DESCRICAO_ANTI_VAZAMENTO: Record<string, string> = {
  cidade:
    "Cidade do ENDERECO de residencia ou do imovel. NAO use a naturalidade/local de nascimento.",
  uf: "UF do ENDERECO de residencia ou do imovel. NAO use a naturalidade.",
  bairro: "Bairro do ENDERECO. null se o documento nao traz endereco.",
  cep: "CEP do ENDERECO. null se o documento nao traz endereco.",
  naturalidade: "Local de NASCIMENTO, como impresso no documento.",
};

const FICHA_PARTE_KEYS = [
  "nome", "cpf", "rg", "data_nascimento", "nome_mae", "naturalidade",
  "estado_civil", "profissao", "nacionalidade", "email", "endereco", "numero",
  "complemento", "bairro", "cidade", "uf", "cep", "cnpj", "razao_social",
];

/**
 * Papéis que `applyFichaResumo` reconhece. Fora desta lista, ele faz
 * `continue` e a parte inteira some — sem erro, sem campo, sem sinal na tela.
 *
 * `papel` merece `enum` pela MESMA razão que `tipo`: um modelo que responda
 * "Vendedor 1" ou "Vendedor" em vez de "vendedor" derruba a pessoa toda, e a
 * ficha-resumo é justamente o documento que preenche o formulário inteiro.
 */
const FICHA_PAPEIS = [
  "vendedor", "comprador",
  "conjuge_vendedor", "conjuge_comprador",
  "representante_vendedor", "representante_comprador",
  "procurador_vendedor", "procurador_comprador",
];

const FICHA_IMOVEL_KEYS = [
  "rua", "numero", "bairro", "cidade", "uf", "cep", "matricula", "cartorio",
  "inscricao_iptu", "inscricao_municipal", "sql", "descricao",
];

/** Objeto de campos STRING nullable, mais quaisquer propriedades extras. */
function objectOf(keys: readonly string[], extraProps: SchemaNode = {}): SchemaNode {
  const properties: SchemaNode = {};
  for (const k of keys) properties[k] = stringField(k);
  return { type: "OBJECT", properties: { ...properties, ...extraProps } };
}

/**
 * Campos do `COMBINED_PROMPT` POR CATEGORIA.
 *
 * ── Por que não é um superset ────────────────────────────────────────────
 *
 * A primeira versão deste PR declarava um objeto único com os ~55 campos de
 * todas as categorias. Medido contra 10 documentos reais em 24/08, isso
 * **suprime a extração** — o modelo, diante de dezenas de propriedades
 * majoritariamente irrelevantes para o documento na frente dele, preenche
 * muito menos. Mesmo documento, `finishReason=STOP` nos dois casos:
 *
 *   CNH (PDF digital limpo):  11 campos SEM schema  →  3 com o superset
 *   certidão de nascimento:   23 campos SEM schema  →  2 com o superset
 *
 * No agregado, a omissão subia de 14,3% para 48,7% e a acurácia caía de 78,6%
 * para 53,3%. Ou seja: era PIOR que não ter schema nenhum.
 *
 * Com o schema enxuto da categoria, a omissão cai para **7,1%** e a acurácia
 * sobe para **86,2%** — melhor que os dois anteriores. É por isso que a
 * extração é feita em DUAS etapas: classificar primeiro, e só então extrair
 * com o schema do que o documento realmente é.
 */
const CAMPOS_POR_CATEGORIA: Record<string, readonly string[]> = {
  rg: ["nome_completo", "rg_numero", "orgao_expedidor", "data_nascimento", "sexo",
       "naturalidade", "filiacao_mae", "filiacao_pai", "conjuge_nome", "conjuge_cpf",
       "cpf_numero", "data_emissao"],
  cpf: ["nome_completo", "cpf_numero", "data_nascimento", "situacao_cadastral"],
  cnh: ["nome_completo", "cpf_numero", "rg_numero", "data_nascimento", "sexo",
        "naturalidade", "filiacao_mae", "filiacao_pai", "categoria", "data_emissao",
        "data_validade", "registro_cnh", "conjuge_nome", "conjuge_cpf"],
  matricula: ["matricula_numero", "cartorio", "endereco_completo", "bairro", "cidade",
              "uf", "cep", "proprietario_nome", "area_total", "onus_existentes",
              "descricao_imovel"],
  iptu: ["inscricao_iptu", "inscricao_municipal", "sql", "endereco", "bairro", "cidade",
         "uf", "valor_venal", "ano_referencia", "debitos_pendentes"],
  escritura: ["vendedor_nome", "comprador_nome", "valor_transacao", "data_lavratura",
              "cartorio", "endereco_imovel", "matricula_referenciada"],
  procuracao: ["outorgante_nome", "outorgante_cpf", "outorgado_nome", "outorgado_cpf",
               "poderes_resumo", "data_lavratura", "prazo_validade"],
  comprovante_residencia: ["titular_nome", "endereco_completo", "bairro", "cidade",
                           "uf", "cep", "emissor"],
  certidao_casamento: ["conjuge1_nome", "conjuge1_cpf", "conjuge2_nome", "conjuge2_cpf",
                       "data_casamento", "regime_bens", "cartorio", "data_lavratura"],
};

/**
 * Etapa 1 — só classificar. Saída minúscula (dois campos), então a chamada
 * extra custa pouco e responde rápido.
 */
const CLASSIFY_SCHEMA: SchemaNode = {
  type: "OBJECT",
  properties: {
    tipo: { type: "STRING", format: "enum", enum: VALID_CATEGORIES },
    confidence: { type: "NUMBER" },
  },
  required: ["tipo", "confidence"],
};

/**
 * Etapa 2 — extrair com o schema DA CATEGORIA detectada.
 *
 * Devolve `null` para `outro` e `ficha_resumo`, que seguem SEM schema de
 * propósito:
 *
 * - `outro` tem contrato free-form no prompt ("inclua todos os dados
 *   relevantes"), e qualquer schema o limita — medido, 22 campos sem schema
 *   contra 7 com o enxuto. Documento fora do catálogo (cartão CNPJ, certidão
 *   de nascimento, comprovante de Pix) é exatamente onde não se sabe de
 *   antemão o que vem.
 * - `ficha_resumo` é estrutura aninhada (`partes[]`/`imoveis[]`) de tamanho
 *   variável, e é ela que preenche o formulário inteiro.
 */
function schemaDaCategoria(categoria: string): SchemaNode | null {
  const campos = CAMPOS_POR_CATEGORIA[categoria];
  if (!campos) return null;
  return {
    type: "OBJECT",
    properties: {
      tipo: { type: "STRING", format: "enum", enum: VALID_CATEGORIES },
      campos: objectOf(campos),
      confidence: { type: "NUMBER" },
    },
    required: ["tipo", "campos", "confidence"],
  };
}

/**
 * O batch segue SEM schema.
 *
 * Ele manda até 4 documentos numa chamada, de categorias potencialmente
 * diferentes — não há "a categoria" para escolher o schema, e o superset é
 * justamente o que se mostrou pior que nada. Além disso o batch está
 * deprecado (Phase F.II) e o `DocumentosStep` não o chama mais.
 */

/**
 * Structured output nasce DESLIGADO — opt-in por `OCR_STRUCTURED_OUTPUT=true`.
 *
 * Ligar isto muda o comportamento de extração de TODO documento em produção, e
 * a régua que diria se muda para melhor (o bench de visão) ainda não rodou
 * sobre documentos reais. O README do ai-bench é explícito: "nada troca de
 * modelo em produção sem passar por aqui primeiro" — e trocar a forma da
 * chamada é a mesma classe de mudança.
 *
 * Sequência prevista: liga em staging → bench e shadow medem → só então o
 * default inverte, em PR próprio, com o número na mão.
 */
function structuredOutputEnabled(): boolean {
  return process.env.OCR_STRUCTURED_OUTPUT === "true";
}

/**
 * Config do `generateContent` para as chamadas de extração.
 *
 * **Não** passar `thinkingConfig` aqui: `gemma-4-31b-it` responde HTTP 400
 * ("Thinking budget is not supported for this model") e derrubaria a chamada
 * inteira. Com `responseSchema` o Gemma já para de emitir raciocínio na saída,
 * que era o motivo de querer o thinkingConfig.
 */
function extractionConfig(schema: SchemaNode | null) {
  if (!structuredOutputEnabled() || !schema) return undefined;
  return { responseMimeType: "application/json", responseSchema: schema };
}

/**
 * O modelo recusou o `responseSchema`/`responseMimeType` — 400 INVALID_ARGUMENT.
 *
 * Separado de `shouldTryFallbackModel` de propósito: aqui a resposta certa não
 * é trocar de modelo (o fallback receberia o mesmo schema), e sim repetir SEM
 * structured output.
 */
export function isSchemaRejectionError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  const é400 = msg.includes("400") || msg.includes("invalid_argument");
  if (!é400) return false;
  return (
    msg.includes("schema") ||
    msg.includes("response_mime_type") ||
    msg.includes("responsemimetype") ||
    msg.includes("response_schema") ||
    msg.includes("responseschema") ||
    msg.includes("json mode") ||
    msg.includes("not supported")
  );
}

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
      const usage = (response as { usageMetadata?: GeminiUsageMetadata }).usageMetadata;
      const tok = geminiUsageToTokens(usage, model);
      recordAIUsage({
        orgId: ctx.orgId,
        userId: ctx.userId,
        contractId: ctx.contractId,
        provider: "gemini",
        model,
        operation: "ocr_form",
        promptTokens: tok.promptTokens,
        completionTokens: tok.completionTokens,
        thoughtsTokens: tok.thoughtsTokens,
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

  // Credencial ANTES do guard de rate-limit, de propósito.
  //
  // `insufficient_quota` da OpenAI vem como **429** — mas é crédito acabado,
  // condição PERMANENTE, não pico de tráfego. Backoff não resolve; trocar de
  // provedor resolve. Sem esta ordem, `msg.includes("429")` devolveria false
  // primeiro e reproduziria o mesmo apagão que esta função existe para evitar,
  // só que com a chave válida e sem saldo.
  if (isConfigCredentialError(msg, err)) return true;

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

/**
 * Credencial do provedor ausente ou recusada — erro de CONFIGURAÇÃO, não de
 * documento nem de capacidade do modelo.
 *
 * Recebe a mensagem já em minúsculas. Cobre o texto que os call-sites lançam
 * (`OPENAI_API_KEY nao configurada`, com e sem acento) e as recusas 401/403 dos
 * provedores, que significam a mesma coisa na prática: este provedor não vai
 * atender, tente outro.
 */
export function isConfigCredentialError(msgLower: string, err?: unknown): boolean {
  // Caminho 1 — CAMPO ESTRUTURADO, o mais confiável: o SDK do Gemini lança
  // `ApiError` com `.status` (verificado no bundle instalado, 1.50.1). Não
  // depende de texto nenhum, então sobrevive a mudança de wording do provedor.
  const status = (err as { status?: unknown } | undefined)?.status;
  if (status === 401 || status === 403) return true;

  // Caminho 2 — a forma que ESTE código monta. `ocr-openai.ts` produz
  // "OpenAI OCR got status: 403. <corpo>".
  if (/got status:\s*(401|403)/.test(msgLower)) return true;

  // Caminho 3 — o corpo JSON que o SDK do Gemini stringifica:
  // {"error":{"message":"…","code":403,"status":"PERMISSION_DENIED"}}.
  //
  // Este é o buraco que quase passou: 403 do Gemini (billing desligado, API
  // não habilitada, chave sem acesso ao modelo) não traz "api key" nem
  // "got status", então nenhum dos outros caminhos pegaria — e como o FALLBACK
  // também é Gemini, uma `GEMINI_API_KEY` recusada apagaria os dois hops.
  if (/"code"\s*:\s*(401|403)\b/.test(msgLower)) return true;
  if (msgLower.includes("permission_denied") || msgLower.includes("unauthenticated")) {
    return true;
  }

  // Caminho 4 — crédito esgotado. Vem como 429, mas é PERMANENTE: backoff não
  // resolve, trocar de provedor resolve. Por isso é tratado aqui e não no
  // guard de rate-limit.
  if (msgLower.includes("insufficient_quota")) return true;

  // Caminho 5 — texto do provedor. Exige as DUAS metades: falar de credencial
  // E dizer que está ausente/recusada. Só "invalid" faria "invalid image"
  // virar erro de config e gastaria um fallback que não resolve nada.
  const falaDeCredencial =
    msgLower.includes("api_key") ||
    msgLower.includes("api key") ||
    msgLower.includes("apikey") ||
    msgLower.includes("credential");
  const ausenteOuRecusada =
    msgLower.includes("nao configurada") ||
    msgLower.includes("não configurada") ||
    msgLower.includes("not configured") ||
    msgLower.includes("not valid") ||
    msgLower.includes("missing") ||
    msgLower.includes("invalid") ||
    msgLower.includes("unauthorized") ||
    /\b401\b/.test(msgLower) ||
    /\b403\b/.test(msgLower);
  return falaDeCredencial && ausenteOuRecusada;
}

/**
 * Uma chamada de extração, no provedor do modelo pedido.
 *
 * O nome `callGemini` ficou por trás deste despacho porque a cascata de
 * fallback, o registro de uso e o parse já falam com ele — trocar a assinatura
 * espalharia a mudança por cinco call-sites sem ganho. O que muda é que agora
 * um modelo `gpt-*` sai por outro caminho.
 */
async function callGemini(
  model: string,
  base64Data: string,
  mimeType: string
): Promise<{ text: string; usage: GeminiUsageMetadata | undefined }> {
  if (isModeloOpenAI(model)) {
    // Duas etapas também aqui: sem a categoria não há schema, e o schema com
    // todos os campos de todas as categorias foi medido como pior que nenhum.
    let schema: Record<string, unknown> | null = null;
    if (structuredOutputEnabled()) {
      try {
        const cls = await chamarOpenAIOcr({
          modelo: model, prompt: COMBINED_PROMPT, base64: base64Data, mimeType,
          schema: { type: "object",
            properties: { tipo: { type: "string" }, confidence: { type: "number" } },
            required: ["tipo", "confidence"] },
        });
        const campos = CAMPOS_POR_CATEGORIA[parseGeminiJson(cls.text).tipo];
        schema = campos ? schemaJsonDeCampos(campos) : null;
      } catch {
        // Classificação é auxiliar: falhou, extrai sem schema.
        schema = null;
      }
    }
    const r = await chamarOpenAIOcr({
      modelo: model, prompt: COMBINED_PROMPT, base64: base64Data, mimeType, schema,
    });
    // Traduz para o shape do `usageMetadata` do Gemini, que é o que
    // `geminiUsageToTokens` e o registro de uso já consomem. `thoughts` fica
    // ZERO de propósito: na OpenAI o raciocínio JÁ está em `completion_tokens`,
    // e somá-lo de novo dobraria o custo reportado.
    return {
      text: r.text,
      usage: {
        promptTokenCount: r.promptTokens,
        candidatesTokenCount: r.completionTokens,
        thoughtsTokenCount: 0,
        totalTokenCount: r.promptTokens + r.completionTokens,
      },
    };
  }

  const ai = getGenAI();
  const contents = [
    { text: COMBINED_PROMPT },
    { inlineData: { mimeType, data: base64Data } },
  ];

  // ── Etapa 1: classificar ────────────────────────────────────────────────
  //
  // Só acontece com structured output ligado. Existe para a etapa 2 poder usar
  // o schema DA CATEGORIA: um schema com os ~55 campos de todas elas suprime a
  // extração (ver CAMPOS_POR_CATEGORIA), e sem classificar antes não há como
  // saber qual schema usar.
  let config: ReturnType<typeof extractionConfig>;
  let usoClassificacao: GeminiUsageMetadata | undefined;
  if (structuredOutputEnabled()) {
    try {
      const cls = await ai.models.generateContent({
        model,
        contents,
        config: { responseMimeType: "application/json", responseSchema: CLASSIFY_SCHEMA as never },
      });
      usoClassificacao = (cls as { usageMetadata?: GeminiUsageMetadata }).usageMetadata;
      const tipo = parseGeminiJson(cls.text ?? "").tipo;
      config = extractionConfig(schemaDaCategoria(tipo));
    } catch (err) {
      // Classificação falhou: segue SEM schema. A etapa 2 é a que importa, e
      // o comportamento sem schema é o de produção hoje — degradar é melhor
      // que derrubar por causa de uma chamada auxiliar.
      if (!isSchemaRejectionError(err)) {
        console.warn(
          `[ocr] classificação (etapa 1) falhou em ${model}: ${err instanceof Error ? err.message.slice(0, 80) : "?"}`
        );
      }
      config = undefined;
    }
  }

  // ── Etapa 2: extrair ────────────────────────────────────────────────────
  let response;
  try {
    response = await ai.models.generateContent({
      model,
      contents,
      ...(config ? { config } : {}),
    });
  } catch (err) {
    // Schema rejeitado (400 INVALID_ARGUMENT) NÃO pode virar apagão do OCR.
    //
    // `shouldTryFallbackModel` só casa 5xx/safety/decode, então um 400 pularia
    // o fallback do Gemini E o último recurso no Claude, e a extração falharia
    // 100% das vezes. E não adiantaria trocar de modelo: o fallback receberia o
    // MESMO schema. A saída certa é degradar para a chamada sem `config`, que é
    // exatamente o comportamento de hoje — pior que com schema, melhor que nada.
    if (config && isSchemaRejectionError(err)) {
      console.warn(
        `[ocr] ${model} rejeitou o responseSchema — repetindo sem structured output`
      );
      response = await ai.models.generateContent({ model, contents });
    } else {
      throw err;
    }
  }
  // O uso soma as DUAS chamadas. Cobrar só a extração esconderia o preço da
  // classificação, que é justamente o custo deste formato.
  const usoExtracao = (response as { usageMetadata?: GeminiUsageMetadata }).usageMetadata;
  return {
    text: response.text ?? "{}",
    usage: somarUso(usoClassificacao, usoExtracao),
  };
}

/** Soma dois `usageMetadata`. `undefined` de um lado devolve o outro. */
function somarUso(
  a: GeminiUsageMetadata | undefined,
  b: GeminiUsageMetadata | undefined
): GeminiUsageMetadata | undefined {
  if (!a) return b;
  if (!b) return a;
  const soma = (x?: number, y?: number) => (x ?? 0) + (y ?? 0);
  return {
    promptTokenCount: soma(a.promptTokenCount, b.promptTokenCount),
    candidatesTokenCount: soma(a.candidatesTokenCount, b.candidatesTokenCount),
    thoughtsTokenCount: soma(a.thoughtsTokenCount, b.thoughtsTokenCount),
    totalTokenCount: soma(a.totalTokenCount, b.totalTokenCount),
    cachedContentTokenCount: soma(a.cachedContentTokenCount, b.cachedContentTokenCount),
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
): Promise<{ text: string; usage: GeminiUsageMetadata | undefined }> {
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
  let usage: GeminiUsageMetadata | undefined;
  let modelUsed = primaryModel;

  try {
    const result = await callGemini(primaryModel, base64Data, mimeType);
    text = result.text;
    usage = result.usage;
  } catch (primaryErr) {
    // Fallback: try a different model on 5xx / safety / decode errors
    if (fallbackModel && fallbackModel !== primaryModel && shouldTryFallbackModel(primaryErr)) {
      const msgPrimario =
        primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
      // Erro de credencial degrada em silêncio se a gente deixar: o documento
      // sai extraído e ninguém descobre que o modelo configurado nunca rodou.
      // Trocar um apagão barulhento por config errada invisível é pior a longo
      // prazo — daí o log em nível próprio, com o que corrigir.
      if (isConfigCredentialError(msgPrimario.toLowerCase())) {
        // NÃO ecoar o corpo do erro: esta é justamente a classe cujo payload
        // carrega material de chave (o 401 da OpenAI devolve o `sk-…` enviado).
        // Um `slice(0, 80)` só esconde por aritmética — muda o prefixo da
        // mensagem e o segredo entra no log. O operador precisa do modelo, da
        // env e do status; nada disso exige o corpo.
        const status = msgPrimario.match(/got status:\s*(\d{3})/)?.[1];
        console.error(
          `[ocr] CONFIG: o modelo ${primaryModel} não rodou por credencial ` +
            `ausente ou recusada${status ? ` (HTTP ${status})` : ""}. Degradando para ` +
            `${fallbackModel} para não perder o documento, mas GEMINI_OCR_MODEL aponta ` +
            `para um provedor cuja chave falta ou não dá acesso a esse modelo. ` +
            `Confira com scripts/verify-ocr.sh.`
        );
      } else {
        console.warn(
          `[ocr] primary model ${primaryModel} failed (${msgPrimario.slice(0, 80)}), trying fallback ${fallbackModel}`
        );
      }
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
          // O segundo hop também precisa gritar quando a causa é config.
          // Cenário real: `GEMINI_OCR_MODEL` num provedor sem chave E
          // `GEMINI_API_KEY` recusada. O primeiro hop loga CONFIG, o segundo
          // caía num warn genérico, e o Claude (que sempre tem chave, porque
          // move o resto do app) salvava a extração — a ~10× o custo, sem
          // ninguém saber que DOIS provedores estão quebrados.
          if (isConfigCredentialError(fallbackMsg.toLowerCase(), fallbackErr)) {
            console.error(
              `[ocr] CONFIG: o fallback ${fallbackModel} TAMBÉM falhou por credencial. ` +
                `Dois provedores fora — caindo no Claude, que custa bem mais. ` +
                `Confira GEMINI_API_KEY com scripts/verify-ocr.sh.`
            );
          } else {
            console.warn(
              `[ocr] fallback Gemini ${fallbackModel} also failed — trying Claude Haiku as last resort`
            );
          }
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
    const providerUsed = modelUsed.startsWith("claude")
      ? "anthropic"
      : isModeloOpenAI(modelUsed)
        ? "openai"
        : "gemini";
    const tok = geminiUsageToTokens(usage, modelUsed);
    recordAIUsage({
      orgId: ctx.orgId,
      userId: ctx.userId,
      contractId: ctx.contractId,
      provider: providerUsed,
      model: modelUsed,
      operation: "ocr_form",
      promptTokens: tok.promptTokens,
      completionTokens: tok.completionTokens,
      thoughtsTokens: tok.thoughtsTokens,
      latencyMs: Date.now() - t0,
      success: true,
    });
  }

  const parsed = parseGeminiJson(text);

  // Shadow: roda um segundo modelo SÓ para medir divergência. Nunca altera o
  // que o usuário vê, e não pode atrasar a resposta — por isso vem depois do
  // `parsed` e é fire-and-forget.
  dispararSombra({
    primario: { documentType: parsed.tipo, fields: parsed.fields },
    primaryModel: modelUsed,
    primaryLatencyMs: Date.now() - t0,
    base64Data,
    mimeType,
    ctx,
  });

  return {
    documentType: parsed.tipo,
    fields: parsed.fields as Record<string, string>,
    confidence: parsed.confidence,
    rawText: text,
  };
}

/**
 * Dispara a chamada sombra e grava a comparação. Nunca lança, nunca espera.
 *
 * **Duas camadas de proteção, e as duas são necessárias:**
 *
 * 1. Desligado por padrão (`OCR_SHADOW_MODEL` vazio). A razão original era que
 *    o preview do projeto `web` falava com o banco de PRODUÇÃO — isso foi
 *    corrigido no incidente de 2026-07-14, e hoje o escopo Preview tem
 *    DATABASE_URL próprio, apontando pro Neon de staging (conferido em
 *    2026-08-25 comparando os hosts). O default desligado fica assim mesmo:
 *    ligar uma segunda chamada de modelo por documento é decisão de custo, e
 *    custo não deve ser efeito colateral de deploy.
 * 2. `try/catch` em tudo. Mesmo ligado, falha de sombra é irrelevante para o
 *    usuário: ele já tem o resultado do modelo primário na mão.
 */
function dispararSombra(p: {
  primario: { documentType: string; fields: Record<string, unknown> };
  primaryModel: string;
  primaryLatencyMs: number;
  base64Data: string;
  mimeType: string;
  ctx?: OcrUsageContext;
}): void {
  const shadowModel = shadowModelFromEnv();
  if (!shadowModel || shadowModel === p.primaryModel) return;

  const tarefa = (async () => {
    const t0 = Date.now();
    let comparacao: ComparacaoSombra | null = null;
    let erro: string | null = null;
    let custo = 0;
    let latencia = 0;

    try {
      const r = await callGemini(shadowModel, p.base64Data, p.mimeType);
      latencia = Date.now() - t0;
      const tok = geminiUsageToTokens(r.usage, shadowModel);
      custo = calcCostUsd(shadowModel, tok.promptTokens, tok.completionTokens);
      const sombra = parseGeminiJson(r.text);
      comparacao = compararSombra(p.primario, {
        documentType: sombra.tipo,
        fields: sombra.fields,
      });
      if (p.ctx) {
        recordAIUsage({
          orgId: p.ctx.orgId,
          userId: p.ctx.userId,
          contractId: p.ctx.contractId,
          provider: "gemini",
          model: shadowModel,
          // Operação PRÓPRIA: sem isso o custo da sombra entraria no total do
          // OCR e o painel diria que a extração ficou 2x mais cara.
          operation: "ocr_shadow",
          promptTokens: tok.promptTokens,
          completionTokens: tok.completionTokens,
          thoughtsTokens: tok.thoughtsTokens,
          latencyMs: latencia,
          success: true,
        });
      }
    } catch (err) {
      latencia = Date.now() - t0;
      erro = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    }

    try {
      await prisma.ocrShadowComparison.create({
        data: {
          orgId: p.ctx?.orgId ?? null,
          attachmentId: p.ctx?.contractId ?? null,
          primaryModel: p.primaryModel,
          shadowModel,
          primaryCategory: p.primario.documentType,
          shadowCategory: comparacao?.categoriaSombra ?? null,
          categoryDiverged: comparacao?.categoriaDivergiu ?? false,
          fieldsEqual: comparacao?.camposIguais ?? 0,
          fieldsDiverged: comparacao?.camposDivergentes ?? [],
          fieldsOnlyPrimary: comparacao?.camposSoNoPrimario ?? [],
          fieldsOnlyShadow: comparacao?.camposSoNaSombra ?? [],
          primaryLatencyMs: p.primaryLatencyMs,
          shadowLatencyMs: latencia,
          shadowCostUsd: custo,
          shadowError: erro,
        },
      });
    } catch (err) {
      console.error("[ocr-shadow] falha ao gravar comparação:", err);
    }
  })();

  try {
    waitUntil(tarefa);
  } catch {
    void tarefa;
  }
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
    const usage = (response as { usageMetadata?: GeminiUsageMetadata }).usageMetadata;
    const tok = geminiUsageToTokens(usage, model);
    recordAIUsage({
      orgId: ctx.orgId,
      userId: ctx.userId,
      contractId: ctx.contractId,
      provider: "gemini",
      model,
      operation: "ocr_form",
      promptTokens: tok.promptTokens,
      completionTokens: tok.completionTokens,
      thoughtsTokens: tok.thoughtsTokens,
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

  // O prompt (e agora o schema) exige `indice`, mas o mapeamento é POSICIONAL.
  // Se o modelo devolver os objetos fora de ordem, o CPF do documento A cai no
  // card do documento B — sem erro, porque o único guard é o tamanho do array.
  // Ordenar por `indice` quando ele vem íntegro fecha esse buraco; quando não
  // vem, a posição continua sendo o melhor palpite disponível.
  const itens = parsed as Array<Record<string, unknown>>;
  const indices = itens.map((o) =>
    typeof (o as { indice?: unknown })?.indice === "number"
      ? ((o as { indice: number }).indice)
      : null
  );
  const indicesIntegros =
    indices.every((n) => n !== null) &&
    new Set(indices).size === indices.length &&
    indices.every((n) => n !== null && n >= 0 && n < items.length);
  const ordenados = indicesIntegros
    ? [...itens].sort(
        (a, b) => (a as { indice: number }).indice - (b as { indice: number }).indice
      )
    : itens;
  if (!indicesIntegros) {
    console.warn(
      "[batch OCR] `indice` ausente ou inconsistente — mapeando por posição"
    );
  }

  return ordenados.map((obj, i) => {
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
