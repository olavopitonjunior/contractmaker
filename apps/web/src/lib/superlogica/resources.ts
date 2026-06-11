// Funções de leitura tipadas por recurso, montadas sobre o client.ts.
// Fábrica `createSuperlogicaClient(creds)` devolve um objeto com um namespace
// por entidade. Somente LEITURA — escrita (POST/PUT) ainda não habilitada
// (precisa de validação em sandbox; ver endpoints.ts / README.md).

import {
  slGet,
  slGetAll,
  type SuperlogicaCredentials,
  type SuperlogicaQuery,
} from "./client";
import type {
  SLAdministradora,
  SLCobranca,
  SLContrato,
  SLDespesa,
  SLDimob,
  SLFilial,
  SLImovel,
  SLPessoa,
  SLRepasse,
  SLSeguradora,
  SLSeguro,
  SLServico,
} from "./types";

/** Helper: pega 1 registro por id (ou null). */
async function getById<T>(
  creds: SuperlogicaCredentials,
  resource: string,
  id: string | number,
  query: SuperlogicaQuery = {},
): Promise<T | null> {
  const resp = await slGet<T>(creds, resource, { ...query, id });
  return resp.data[0] ?? null;
}

export function createSuperlogicaClient(creds: SuperlogicaCredentials) {
  return {
    /** Acesso cru a qualquer recurso (uma página). */
    raw: <T = Record<string, unknown>>(resource: string, query?: SuperlogicaQuery) =>
      slGet<T>(creds, resource, query),
    /** Acesso cru paginado (todas as páginas). */
    rawAll: <T = Record<string, unknown>>(resource: string, query?: SuperlogicaQuery) =>
      slGetAll<T>(creds, resource, query),

    contratos: {
      list: (query: SuperlogicaQuery = {}) => slGetAll<SLContrato>(creds, "contratos", query),
      get: (id: string | number, query: SuperlogicaQuery = {}) =>
        getById<SLContrato>(creds, "contratos", id, query),
    },
    imoveis: {
      list: (query: SuperlogicaQuery = {}) => slGetAll<SLImovel>(creds, "imoveis", query),
      get: (id: string | number, query: SuperlogicaQuery = {}) =>
        getById<SLImovel>(creds, "imoveis", id, query),
    },
    proprietarios: {
      list: (query: SuperlogicaQuery = {}) => slGetAll<SLPessoa>(creds, "proprietarios", query),
      get: (id: string | number, query: SuperlogicaQuery = {}) =>
        getById<SLPessoa>(creds, "proprietarios", id, query),
    },
    locatarios: {
      list: (query: SuperlogicaQuery = {}) => slGetAll<SLPessoa>(creds, "locatarios", query),
      get: (id: string | number, query: SuperlogicaQuery = {}) =>
        getById<SLPessoa>(creds, "locatarios", id, query),
    },
    fiadores: {
      list: (query: SuperlogicaQuery = {}) => slGetAll<SLPessoa>(creds, "fiadores", query),
    },
    corretores: {
      list: (query: SuperlogicaQuery = {}) => slGetAll<SLPessoa>(creds, "corretores", query),
    },
    pessoas: {
      list: (query: SuperlogicaQuery = {}) => slGetAll<SLPessoa>(creds, "pessoas", query),
    },
    cobrancas: {
      list: (query: SuperlogicaQuery = {}) => slGetAll<SLCobranca>(creds, "cobrancas", query),
    },
    despesas: {
      list: (query: SuperlogicaQuery = {}) => slGetAll<SLDespesa>(creds, "despesas", query),
    },
    /** Despesas do contrato/imóvel (recurso `imoveisdespesa` do Apiary). */
    imoveisDespesa: {
      list: (query: SuperlogicaQuery = {}) =>
        slGetAll<Record<string, unknown>>(creds, "imoveisdespesa", query),
    },
    repasses: {
      list: (query: SuperlogicaQuery = {}) => slGetAll<SLRepasse>(creds, "repasses", query),
    },
    dimob: {
      list: (query: SuperlogicaQuery = {}) => slGetAll<SLDimob>(creds, "dimob", query),
    },
    seguros: {
      list: (query: SuperlogicaQuery = {}) => slGetAll<SLSeguro>(creds, "seguros", query),
    },
    seguradoras: {
      list: (query: SuperlogicaQuery = {}) => slGetAll<SLSeguradora>(creds, "seguradoras", query),
    },
    administradoras: {
      list: (query: SuperlogicaQuery = {}) =>
        slGetAll<SLAdministradora>(creds, "administradoras", query),
    },
    servicos: {
      list: (query: SuperlogicaQuery = {}) => slGetAll<SLServico>(creds, "servicos", query),
    },
    filiais: {
      list: (query: SuperlogicaQuery = {}) => slGetAll<SLFilial>(creds, "filiais", query),
    },
  };
}

export type SuperlogicaClient = ReturnType<typeof createSuperlogicaClient>;
