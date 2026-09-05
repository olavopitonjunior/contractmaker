// Funções de leitura tipadas por recurso, montadas sobre o client.ts.
// Fábrica `createSuperlogicaClient(creds)` devolve um objeto com um namespace
// por entidade. Somente LEITURA — escrita (POST/PUT) ainda não habilitada
// (precisa de validação em sandbox; ver endpoints.ts / README.md).

import {
  slGet,
  slGetAll,
  slPostForm,
  slPostJson,
  type FormFields,
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
  SLImovelCreateInput,
  SLPessoa,
  SLPessoaCreateInput,
  SLRepasse,
  SLSeguradora,
  SLSeguro,
  SLServico,
  SLVenda,
  SLVendaDespesaInput,
  SLVendaPutPayload,
} from "./types";

/** Só dígitos de CPF/CNPJ (a Superlógica grava com máscara ou sem). */
function onlyDigits(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

/** Resposta de criação de pessoa/imóvel: o registro criado, com id. */
type Created<T> = { data: T; msg: string };

/** CPF/CNPJ com a máscara que a tela da Superlógica grava. */
function maskDoc(digits: string): string {
  if (digits.length === 11)
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (digits.length === 14)
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return digits;
}

/**
 * Busca pessoa pelo documento. `pessoas?pesquisa=` casa por texto (nome ou
 * documento); como a Superlógica grava o documento com OU sem máscara,
 * pesquisamos nas duas formas e filtramos pelo documento normalizado — nunca
 * reutilizamos por nome. Sem documento → null.
 *
 * A confirmar no smoke de staging (PR 3): que `pesquisa=` indexa o documento.
 * Se não indexar, o fallback é `pessoas.list` paginado filtrando localmente.
 */
async function findPessoaByDoc(
  creds: SuperlogicaCredentials,
  doc: string,
): Promise<SLPessoa | null> {
  const digits = onlyDigits(doc);
  if (digits.length < 11) return null;
  for (const termo of [digits, maskDoc(digits)]) {
    const resp = await slGet<SLPessoa>(creds, "pessoas", { pesquisa: termo, itensPorPagina: 50 });
    const hit = resp.data.find((p) => onlyDigits(p.st_cnpj_pes) === digits);
    if (hit) return hit;
  }
  return null;
}

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

    // ----------------------------------------------------------------------
    // ESCRITA (provada em produção em 2026-09-02/03 — ver docs/integracoes/
    // superlogica-vendas-export.md). Nunca chamar contra a base real fora do
    // fluxo de exportação; a reversão de uma venda é `vendas.setStatus(id, -1)`.
    // ----------------------------------------------------------------------
    escrita: {
      pessoas: {
        /** Pessoa existente com o mesmo CPF/CNPJ, ou null. */
        findByDoc: (doc: string) => findPessoaByDoc(creds, doc),
        /** Vendedor/comprador: `POST proprietarios` (a venda marca o comprador). */
        createProprietario: (input: SLPessoaCreateInput): Promise<Created<SLPessoa>> =>
          slPostJson<SLPessoa>(creds, "proprietarios", {
            ...(input as unknown as FormFields),
            FL_PROPRIETARIOBENEFICIARIO_PES: 1,
          }),
        /** Comissionado: `POST corretores` (a Superlógica cria o favorecido). */
        createCorretor: (input: SLPessoaCreateInput): Promise<Created<SLPessoa>> =>
          slPostJson<SLPessoa>(creds, "corretores", {
            ...(input as unknown as FormFields),
            FL_CORRETOR_PES: 1,
          }),
        /**
         * Corretor com o `id_favorecido_fav` (o GET de `corretores` traz o
         * favorecido; o POST pode não trazer). A venda exige o favorecido em
         * VENDEDORES/COMISSOES/VENDEDORPARCELA — resolver antes de montar.
         */
        findCorretorById: async (id: string | number): Promise<SLPessoa | null> => {
          const resp = await slGet<SLPessoa>(creds, "corretores", { id, itensPorPagina: 1 });
          return resp.data.find((p) => String(p.id_pessoa_pes) === String(id)) ?? null;
        },
      },
      imoveis: {
        create: (input: SLImovelCreateInput): Promise<Created<SLImovel>> =>
          slPostJson<SLImovel>(creds, "imoveis", input as unknown as FormFields),
        /** Reutilização por identificador externo (`cm:<dealId>`). */
        findByIdentificador: async (identificador: string): Promise<SLImovel | null> => {
          const resp = await slGet<SLImovel>(creds, "imoveis", {
            pesquisa: identificador,
            itensPorPagina: 50,
          });
          return resp.data.find((i) => i.st_identificador_imo === identificador) ?? null;
        },
      },
      vendas: {
        get: async (id: string | number): Promise<SLVenda | null> => {
          const resp = await slGet<SLVenda>(creds, "vendas", { id });
          return resp.data[0] ?? null;
        },
        /** Cria a venda completa em 1 POST (payload do assistente "Nova venda"). */
        create: (payload: SLVendaPutPayload): Promise<Created<SLVenda>> =>
          slPostForm<SLVenda>(creds, "vendas/put", payload as unknown as FormFields),
        /**
         * Altera — SUBSTITUIÇÃO TOTAL: enviar o conjunto completo (compradores,
         * vendedores, comissões, parcelas), senão o que faltar é cancelado.
         */
        update: (id: string | number, payload: SLVendaPutPayload): Promise<Created<SLVenda>> =>
          slPostForm<SLVenda>(creds, "vendas/post", {
            ...(payload as unknown as FormFields),
            ID_VENDA_VEN: String(id),
          }),
        /**
         * Exclui a venda (apaga venda + cobranças + despesas) — é o que o botão
         * "Excluir" da tela envia (ID + FL_STATUS_VEN=-1), provado ao vivo.
         * CANCELAR (status 1) NÃO está exposto: passa pelo mesmo `vendas/post`,
         * que é substituição total, e nunca foi exercido só com 2 campos —
         * implementar como get → payload completo com FL_STATUS_VEN=1 quando
         * for provado.
         */
        excluir: (id: string | number) =>
          slPostForm<unknown>(creds, "vendas/post", {
            ID_VENDA_VEN: String(id),
            FL_STATUS_VEN: "-1",
          }),
        /** Despesa vinculada à venda (comissão a pagar ao comissionado). */
        lancarDespesa: (input: SLVendaDespesaInput) =>
          slPostForm<unknown>(creds, "vendas/lancardespesa", input as unknown as FormFields),
      },
    },
  };
}

export type SuperlogicaClient = ReturnType<typeof createSuperlogicaClient>;
