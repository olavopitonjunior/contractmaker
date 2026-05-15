// Labels canônicos compartilhados entre o form (PagamentoStep.tsx) e
// enrichContractData (contract-generation.ts). Manter as chaves em sincronia
// com `parcelaTipoEnum`, `parcelaMomentoEnum`, `parcelaMeioEnum` em
// lib/forms/validation.ts — esses enums são a fonte de verdade do shape.

export const TIPO_LABELS = {
  sinal_arras: "Sinal / Arras",
  recursos_proprios: "Recursos Próprios",
  fgts: "FGTS",
  financiamento: "Financiamento Bancário",
  cessao_consorcio: "Cessão de Consórcio",
  permuta_veiculo: "Permuta com Veículo",
  permuta_imovel: "Permuta com Imóvel",
  outros: "Outros (especificar)",
} as const;

export const MOMENTO_LABELS = {
  assinatura: "Na assinatura do contrato",
  escritura: "Na escritura pública",
  registro: "No registro do imóvel",
  dias: "X dias após a assinatura",
  data_exata: "Em data específica",
} as const;

// Texto canônico do "contados de" usado no corpo da cláusula da parcela.
// Distinto do label da UI (que descreve a opção do select).
export const MOMENTO_TEXTO = {
  assinatura: "contados da assinatura deste instrumento",
  escritura: "contados da lavratura da escritura pública",
  registro:
    "contados do registro do Contrato de Financiamento com Alienação Fiduciária junto ao Cartório de Registro de Imóveis competente",
  dias: "contados da assinatura deste instrumento",
  data_exata: "",
} as const;

export const MEIO_LABELS = {
  pix: "PIX",
  ted: "TED / Transferência Bancária",
  boleto: "Boleto",
  dinheiro: "Dinheiro (espécie)",
  cheque: "Cheque",
  financiamento: "Financiamento Bancário",
  fgts_saque: "Saque do FGTS",
  permuta: "Permuta",
  transferencia: "Transferência bancária",
} as const;

// Texto canônico do "mediante X" usado no corpo da cláusula.
export const MEIO_PAGAMENTO_TEXTO = {
  pix: "mediante PIX",
  ted: "mediante TED ou transferência bancária",
  boleto: "mediante boleto bancário",
  dinheiro: "em espécie (dinheiro)",
  cheque: "mediante cheque administrativo nominal",
  financiamento:
    "mediante crédito imobiliário a ser liberado pelo agente financeiro",
  fgts_saque: "mediante saque do FGTS (Fundo de Garantia do Tempo de Serviço)",
  permuta: "mediante entrega do bem permutado",
  transferencia: "mediante transferência bancária (TED ou PIX)",
} as const;

export const PIX_TIPO_CHAVE_LABELS = {
  CPF: "CPF",
  CNPJ: "CNPJ",
  EMAIL: "e-mail",
  PHONE: "telefone",
  EVP: "chave aleatória",
} as const;

export const TIPO_CONTA_LABELS = {
  corrente: "corrente",
  poupanca: "poupança",
} as const;

export const BANCO_FINANCIAMENTO_LABELS = {
  caixa: "Caixa Econômica Federal",
  bb: "Banco do Brasil",
  itau: "Itaú",
  bradesco: "Bradesco",
  santander: "Santander",
  inter: "Banco Inter",
  outro: "Outro banco",
} as const;

export const PAPEL_LABELS = {
  captador: "Captador(a) do imóvel",
  intermediador: "Intermediador(a)",
  indicador: "Indicador(a)",
  imobiliaria_principal: "Imobiliária principal",
  outro: "",
} as const;

// Helpers tipados pra uso em UI (selects) — preservam ordem de declaração.
export function toOptions<T extends Record<string, string>>(
  labels: T
): Array<{ value: keyof T & string; label: T[keyof T] }> {
  return (Object.entries(labels) as Array<[keyof T & string, T[keyof T]]>).map(
    ([value, label]) => ({ value, label })
  );
}
