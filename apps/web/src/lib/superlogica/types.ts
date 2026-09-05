// Tipos das entidades da API Superlógica Imobiliárias.
//
// IMPORTANTE: a API devolve TODOS os valores como string (inclusive números e
// flags "0"/"1"). Os campos abaixo são tipados como string crua; use os helpers
// `toNumber` / `toBool` / `parseSuperlogicaDate` do client.ts para coagir.
//
// Cada interface tipa os campos de alto valor (ids, valores, datas, status) e
// mantém `[key: string]: unknown` para a cauda longa de campos não modelados
// (alguns recursos têm 150+ colunas — ver superlogica-api-data-dictionary.md).

/** Campos comuns a registros de pessoa (proprietário/locatário/fiador/corretor). */
export interface SLPessoa {
  id_pessoa_pes?: string;
  /** Presente em `corretores`: favorecido (contas a pagar) do corretor. */
  id_favorecido_fav?: string;
  fl_corretor_pes?: string;
  st_nome_pes?: string;
  st_fantasia_pes?: string;
  st_cnpj_pes?: string; // CPF ou CNPJ (nome histórico)
  st_email_pes?: string;
  st_telefone_pes?: string;
  st_endereco_pes?: string;
  st_numero_pes?: string;
  st_complemento_pes?: string;
  st_bairro_pes?: string;
  st_cidade_pes?: string;
  st_estado_pes?: string;
  st_cep_pes?: string;
  [key: string]: unknown;
}

export interface SLImovel {
  id_imovel_imo?: string;
  st_tipo_imo?: string;
  st_endereco_imo?: string;
  st_numero_imo?: string;
  st_complemento_imo?: string;
  st_bairro_imo?: string;
  st_cidade_imo?: string;
  st_estado_imo?: string;
  st_cep_imo?: string;
  st_identificador_imo?: string;
  st_tipodimob_imo?: string; // "U" urbano | "R" rural
  vl_venda_imo?: string;
  id_filial_fil?: string;
  [key: string]: unknown;
}

export interface SLContrato {
  id_contrato_con?: string;
  id_tipo_con?: string;
  id_imovel_imo?: string;
  dt_inicio_con?: string;
  dt_fim_con?: string;
  dt_rescisao_con?: string;
  fl_ativo_con?: string;
  fl_suspenso_con?: string;
  vl_aluguel_con?: string;
  tx_adm_con?: string;
  tx_locacao_con?: string;
  nm_diavencimento_con?: string;
  id_indicereajuste_con?: string;
  nm_mesreajuste_con?: string;
  dt_ultimoreajuste_con?: string;
  nm_diarepasse_con?: string;
  fl_diafixorepasse_con?: string;
  nm_repassegarantido_con?: string;
  fl_tiporepassegarantido_con?: string;
  fl_garantia_con?: string;
  id_garantia_grt?: string;
  vl_valorgarantia_con?: string;
  fl_seguroincendio_con?: string;
  vl_seguroincendio_con?: string;
  fl_reterir_con?: string;
  fl_emitirnotafiscal_con?: string;
  fl_split_con?: string;
  fl_dimob_con?: string;
  fl_renovacaoautomatica_con?: string;
  tx_multacontratual_con?: string;
  id_corretor_con?: string;
  id_filial_fil?: string;
  // Presentes quando comDadosDos*=1:
  inquilinos?: SLPessoa[];
  encargos_imoveis?: Array<Record<string, unknown>>;
  proprietarios_beneficiarios?: SLProprietarioBeneficiario[];
  [key: string]: unknown;
}

export interface SLProprietarioBeneficiario {
  id_pessoa_pes?: string;
  st_nome_pes?: string;
  contratos?: SLContrato[];
  [key: string]: unknown;
}

export interface SLRepasse {
  id_repasse_rep?: string;
  id_recebimento_recb?: string;
  dt_repasse_rep?: string;
  dt_proc_rep?: string;
  fl_status_rep?: string;
  vl_aluguel_rep?: string;
  vl_txadm_rep?: string;
  tx_adm_rep?: string;
  fl_txadmfixa_rep?: string;
  fl_garantido_rep?: string;
  fl_repassougarantido_rep?: string;
  fl_split_rep?: string;
  fl_spliterro?: string;
  split_indisponivel?: unknown;
  dt_liquidacao_recb?: string;
  dt_credito_recb?: string;
  vl_total_recb?: string;
  dt_notafiscal_rep?: string;
  id_acordo_aco?: string;
  id_locatario_pes?: string;
  id_contrato_con?: string;
  proprietarios_beneficiarios?: SLProprietarioBeneficiario[];
  [key: string]: unknown;
}

export interface SLCobranca {
  id_recebimento_recb?: string;
  id_sacado_sac?: string;
  st_nome_sac?: string;
  dt_vencimento_recb?: string;
  dt_vencimentooriginal_recb?: string;
  dt_liquidacao_recb?: string;
  dt_geracao_recb?: string;
  vl_total_recb?: string;
  vl_emitido_recb?: string;
  vl_txmulta_recb?: string;
  vl_txjuros_recb?: string;
  vl_txdesconto_recb?: string;
  fl_status_recb?: string;
  st_nossonumero_recb?: string;
  st_pixqrcode_recb?: string;
  link_2via?: string;
  id_contrato_mens?: string;
  id_filial_fil?: string;
  [key: string]: unknown;
}

export interface SLDespesa {
  id_despesa?: string;
  vencimento?: string;
  competencia?: string;
  vl_valor_imod?: string;
  id_produto_prd?: string;
  id_debito_imod?: string;
  id_credito_imod?: string;
  id_proprietariodebito_imod?: string;
  id_proprietariocredito_imod?: string;
  fl_status_imod?: string;
  fl_repassar_imod?: string;
  id_repasse_rep?: string;
  id_acordo_aco?: string;
  id_seguro_seg?: string;
  id_imovel_imo?: string;
  id_contrato_con?: string;
  st_descricao_prd?: string;
  repasses?: Array<Record<string, unknown>>;
  movimentacoes?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface SLDimob {
  id_dimob_dlc?: string;
  id_contrato_con?: string;
  id_imovel_imo?: string;
  id_locatario_pes?: string;
  id_proprietario_pes?: string;
  proprietario?: string;
  cnpj_proprietario?: string;
  locatario?: string;
  dt_inicio_con?: string;
  dt_fim_con?: string;
  dt_rescisao_con?: string;
  fl_ativo_con?: string;
  fl_reterir_con?: string;
  st_tipodimob_imo?: string;
  detalhes_contrato?: unknown;
  [key: string]: unknown;
}

export interface SLSeguro {
  id_seguro_seg?: string;
  id_imovel_imo?: string;
  id_contrato_con?: string;
  id_seguradora_seg?: string;
  fl_status_seg?: string;
  dt_inicio_seg?: string;
  dt_fim_seg?: string;
  vl_valorparcela_seg?: string;
  vl_cobertura_seg?: string;
  vl_premio_seg?: string;
  nm_parcelas_seg?: string;
  apolice_numero?: string;
  st_plano_seg?: string;
  fl_responsavel_seg?: string;
  [key: string]: unknown;
}

export interface SLSeguradora {
  id_seguradora_seg?: string;
  st_nome_seg?: string;
  st_telefone_seg?: string;
  st_email_seg?: string;
  [key: string]: unknown;
}

export interface SLAdministradora {
  id_administradora_adm?: string;
  st_nome_adm?: string;
  id_imovel_imo?: string;
  [key: string]: unknown;
}

export interface SLServico {
  id_produto_prd?: string;
  fl_cobrartxadm_prd?: string;
  fl_deduzir_prd?: string;
  [key: string]: unknown;
}

export interface SLFilial {
  id_filial_fil?: string;
  st_nome_fil?: string;
  st_razaosocial_fil?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Vendas (módulo Vendas) — shape do GET `vendas?id=` observado em 2026-09-03.
// ---------------------------------------------------------------------------

export interface SLVendaVendedor {
  id_vendedores_vev?: string;
  id_vendedor_vev?: string;
  id_favorecido_fav?: string;
  st_nome_pes?: string;
  vl_comissao_ang?: string;
  fl_valorcomissao_ang?: string;
  fl_tipo_ang?: string;
  [key: string]: unknown;
}

export interface SLVendaComissao {
  id_item_vei?: string;
  id_lancamento_vei?: string;
  fl_tipo_vei?: string; // 1 parcela a receber | 2 despesa | 3 comissão
  id_vendedor_vev?: string;
  id_favorecido_fav?: string;
  st_nome_pes?: string;
  vl_item_vei?: string;
  dt_vencimento_vei?: string;
  nm_parcela_vei?: string;
  fl_despesa?: string;
  dt_lancamento_mov?: string | null;
  dt_liquidacao_mov?: string | null;
  fl_status_mov?: string | null;
  [key: string]: unknown;
}

export interface SLVendaParcela {
  id_recebimento_recb?: string;
  id_sacado_sac?: string;
  vl_total_recb?: string;
  vl_emitido_recb?: string;
  dt_vencimento_recb?: string;
  dt_liquidacao_recb?: string;
  fl_status_recb?: string; // 0 aberta | 1 liquidada | 2 cancelada
  [key: string]: unknown;
}

export interface SLVenda {
  id_venda_ven?: string;
  dt_venda_ven?: string;
  vl_total_ven?: string;
  vl_comissao_ven?: string;
  vl_totalcomissao_ven?: string;
  fl_status_ven?: string; // "" ativa | "1" cancelada | "2" pendente | "-1" excluída
  fl_tipopagamentocomissao_ven?: string;
  fl_tiporecebimentocomissao_ven?: string;
  fl_dimob_ven?: string;
  fl_notafiscal_ven?: string;
  id_contabanco_cb?: string;
  id_filial_fil?: string;
  id_imovel_imo?: string;
  st_endereco_imo?: string;
  st_observacao_ven?: string;
  dt_atualizacao_ven?: string;
  vendas_compradores?: Array<SLPessoa & { id_sacado_sac?: string; nm_fracao_vec?: string; fl_principal_vec?: string }>;
  vendedores?: SLVendaVendedor[];
  comissoes?: SLVendaComissao[];
  vendas_itens?: SLVendaComissao[];
  despesas?: Array<Record<string, unknown>>;
  comissao_parcelas?: SLVendaParcela[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Payloads de ESCRITA (chaves em MAIÚSCULAS, como a API espera).
// ---------------------------------------------------------------------------

/** `POST proprietarios` / `corretores` (JSON). Só `ST_NOME_PES` + flag são obrigatórios. */
export interface SLPessoaCreateInput {
  ST_NOME_PES: string;
  ST_FANTASIA_PES?: string;
  ST_CNPJ_PES?: string;
  ST_RG_PES?: string;
  ST_SEXO_PES?: 1 | 2;
  DT_NASCIMENTO_PES?: string; // MM/DD/YYYY
  ST_NACIONALIDADE_PES?: string;
  ST_EMAIL_PES?: string;
  ST_CELULAR_PES?: string;
  ST_TELEFONE_PES?: string;
  ST_CEP_PES?: string;
  ST_ENDERECO_PES?: string;
  ST_NUMERO_PES?: string;
  ST_COMPLEMENTO_PES?: string;
  ST_BAIRRO_PES?: string;
  ST_CIDADE_PES?: string;
  ST_ESTADO_PES?: string;
  ST_OBSERVACAO_PES?: string;
  FL_PROPRIETARIOBENEFICIARIO_PES?: 1;
  FL_LOCATARIO_PES?: 1;
  FL_CORRETOR_PES?: 1;
}

/** `POST imoveis` (JSON). */
export interface SLImovelCreateInput {
  ST_TIPO_IMO: string;
  ST_CEP_IMO: string;
  ST_ENDERECO_IMO: string;
  ST_NUMERO_IMO?: string;
  ST_COMPLEMENTO_IMO?: string;
  ST_BAIRRO_IMO: string;
  ST_CIDADE_IMO: string;
  ST_ESTADO_IMO?: string;
  ST_IDENTIFICADOR_IMO?: string;
  VL_VENDA_IMO?: string;
  VL_ALUGUEL_IMO?: string;
  PROPRIETARIOS_BENEFICIARIOS: Array<{
    ID_PESSOA_PES: string;
    /** -1 principal, 1 proprietário, 2 beneficiário */
    FL_PROPRIETARIO_PRB: string;
    NM_FRACAO_PRB: string;
  }>;
}

/**
 * `POST vendas/put` (form-urlencoded) — espelho do payload do assistente
 * "Nova venda". `VENDEDORPARCELA<n>` (n = nº da parcela) é o bloco que cria
 * o item de comissão; `COMISSOES` sozinho é ignorado.
 */
export interface SLVendaPutPayload {
  ID_IMOVEL_IMO: string;
  DT_VENDA_VEN: string;
  VL_TOTAL_VEN: string;
  TX_COMISSAO_VEN: string;
  VL_TOTALCOMISSAO_VEN: string;
  VL_COMISSAO_VEN: string;
  NM_PARCELAS: string;
  VENDAS_COMPRADORES: Array<{
    ST_NOME_PES: string;
    FL_PROPRIETARIOBENEFICIARIO_PES: "1";
    FL_COMPRADOR_PES: "1";
    ID_PESSOA_PES: string;
    NM_FRACAO_VEC: string;
    FL_PRINCIPAL_VEC: "0" | "1";
  }>;
  VENDEDORES: Array<{
    ST_NOME_PES: string;
    ID_PESSOA_PES: "";
    VL_COMISSAO_ANG: string;
    FL_VALORCOMISSAO_ANG: "1" | "2";
    FL_TIPO_ANG: string;
    ID_VENDEDORES_VEV: "";
    ID_VENDEDOR_VEV: string;
    ID_FAVORECIDO_FAV: string;
  }>;
  COMISSOES: Array<{
    ID_ITEM_VEI: "";
    ID_LANCAMENTO_VEI: "";
    FL_STATUS_MOV: "";
    DT_VENCIMENTO_VEI: string;
    ID_VENDEDOR_VEV: string;
    ID_FAVORECIDO_FAV: string;
    ST_NOME_PES: string;
    VL_ITEM_VEI: string;
    FL_DESPESA: "0";
    NM_PARCELA_VEI: string;
  }>;
  COMISSAO_PARCELAS: Array<{
    ID_RECEBIMENTO_RECB: "";
    DT_VENCIMENTO_RECB: string;
    VL_EMITIDO_RECB: string;
    FL_STATUS_RECB: "0";
    ST_OBSERVACAOEXTERNA_RECB: string;
    VL_TOTAL_RECB: string;
  }>;
  FL_NOTAFISCAL_VEN: "0" | "1";
  FL_DIMOB_VEN: "0" | "1";
  FL_DESTINACAOFISCAL_VEN: "" | "1" | "2";
  ID_FILIAL_FIL: string;
  ID_CONTABANCO_CB: string;
  FL_TIPORECEBIMENTOCOMISSAO_VEN: "0" | "1";
  FL_TIPOPAGAMENTOCOMISSAO_VEN: "0" | "1";
  FL_STATUS_VEN: "" | "2";
  ID_TIPO_VEN: "" | "1" | "2";
  ST_OBSERVACAO_VEN: string;
  ITENSLIQUIDADOS: "0";
  /** `VENDEDORPARCELA1`, `VENDEDORPARCELA2`… — um bloco por parcela. */
  [vendedorParcela: `VENDEDORPARCELA${number}`]: Array<{
    ID_ITEM_VEI: "";
    ID_LANCAMENTO_VEI: "";
    FL_STATUS_MOV: "";
    DT_VENCIMENTO_VEI: string;
    ST_NOME_PES: "";
    ID_VENDEDOR_VEV: string;
    ST_FANTASIA_FAV: string;
    ID_FAVORECIDO_FAV: string;
    VL_ITEM_VEI: string;
    NM_PARCELA_VEI: string;
  }>;
}

/** `POST vendas/lancardespesa` — despesa vinculada à venda (comissão a pagar). */
export interface SLVendaDespesaInput {
  ID_VENDA_VEN: string;
  ID_CONTABANCO_CB: string;
  DT_VENCIMENTO_MOV: string;
  VL_VALOR_MOV: string;
  ID_FAVORECIDO_FAV: string;
  ST_FANTASIA_FAV: string;
  ST_CONTA_CONT: string;
  ST_DESCRICAO_CONT: string;
  ST_COMPLEMENTO_DES?: string;
}
