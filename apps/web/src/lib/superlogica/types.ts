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
