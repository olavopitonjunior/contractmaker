/**
 * Rótulos PT-BR das chaves que o OCR devolve em `extractedData.fields`.
 *
 * **Por que não reusa `field-labels.ts`:** aquele catálogo mapeia PATHS do
 * formulário (`vendedores.0.cpf` → "Vendedor 1 — CPF"), e o que chega do OCR
 * são as chaves do `COMBINED_PROMPT` (`cpf_numero`), que existem antes de
 * qualquer atribuição a um slot. São dois vocabulários diferentes.
 *
 * Manter em sincronia com `COMBINED_PROMPT` em `lib/ai/ocr.ts`. Chave sem
 * rótulo aqui não quebra nada: `ocrFieldLabel` cai num fallback legível.
 *
 * Client-safe (sem prisma) — o consumidor é um dialog de componente de cliente.
 */
const OCR_FIELD_LABELS: Record<string, string> = {
  // Identidade (rg, cpf, cnh)
  nome_completo: "Nome completo",
  rg_numero: "RG",
  orgao_expedidor: "Órgão expedidor",
  cpf_numero: "CPF",
  data_nascimento: "Data de nascimento",
  sexo: "Sexo",
  naturalidade: "Naturalidade",
  filiacao_mae: "Nome da mãe",
  filiacao_pai: "Nome do pai",
  situacao_cadastral: "Situação cadastral",
  categoria: "Categoria da CNH",
  data_emissao: "Data de emissão",
  data_validade: "Validade",
  registro_cnh: "Registro da CNH",
  conjuge_nome: "Cônjuge",
  conjuge_cpf: "CPF do cônjuge",

  // Imóvel (matrícula, escritura)
  matricula_numero: "Matrícula",
  cartorio: "Cartório",
  endereco_completo: "Endereço",
  endereco: "Endereço",
  endereco_imovel: "Endereço do imóvel",
  bairro: "Bairro",
  cidade: "Cidade",
  uf: "UF",
  cep: "CEP",
  proprietario_nome: "Proprietário",
  area_total: "Área total",
  onus_existentes: "Ônus e gravames",
  descricao_imovel: "Descrição do imóvel",
  matricula_referenciada: "Matrícula referenciada",

  // IPTU
  inscricao_iptu: "Inscrição do IPTU",
  inscricao_municipal: "Inscrição municipal",
  sql: "SQL (setor-quadra-lote)",
  valor_venal: "Valor venal",
  ano_referencia: "Ano de referência",
  debitos_pendentes: "Débitos pendentes",

  // Escritura
  vendedor_nome: "Vendedor",
  comprador_nome: "Comprador",
  valor_transacao: "Valor da transação",
  data_lavratura: "Data de lavratura",

  // Procuração
  outorgante_nome: "Outorgante",
  outorgante_cpf: "CPF do outorgante",
  outorgado_nome: "Outorgado (procurador)",
  outorgado_cpf: "CPF do outorgado",
  poderes_resumo: "Poderes concedidos",
  prazo_validade: "Prazo de validade",

  // Comprovante de residência
  titular_nome: "Titular",
  emissor: "Emissor",

  // Certidão de casamento
  conjuge1_nome: "Cônjuge 1",
  conjuge1_cpf: "CPF do cônjuge 1",
  conjuge2_nome: "Cônjuge 2",
  conjuge2_cpf: "CPF do cônjuge 2",
  data_casamento: "Data do casamento",
  regime_bens: "Regime de bens",

  // Categoria "outro" — rótulo livre que o próprio modelo atribui
  tipo_documento: "Tipo de documento",

  // Ficha-resumo
  partes: "Partes",
  imoveis: "Imóveis",
};

/**
 * Rótulo legível de uma chave de OCR. Sem entrada no mapa, troca `_` por
 * espaço e capitaliza — que é o que o card já fazia inline, agora como
 * fallback explícito em vez de regra única.
 */
export function ocrFieldLabel(key: string): string {
  const known = OCR_FIELD_LABELS[key];
  if (known) return known;
  const spaced = key.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
