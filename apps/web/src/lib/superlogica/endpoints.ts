// Catálogo de endpoints da API Superlógica Imobiliárias com a disponibilidade
// REAL verificada ao vivo (2026-05-29, licença adm037585, somente GET).
// Fonte: docs/locacao/superlogica-api-benchmark.md.

export type ReadAvailability =
  | "read" // GET retorna dados — pronto para consumo
  | "read-empty-in-test" // endpoint existe, mas base de teste vazia (shape a confirmar)
  | "param-required" // existe, mas exige parâmetro ainda não mapeado
  | "absent"; // status 404 — não existe

export type WriteAvailability =
  | "crud-documented" // POST/PUT documentado no Apiary (não testado em produção)
  | "unconfirmed" // endpoint existe mas escrita não documentada/testada
  | "none";

export interface SuperlogicaEndpointMeta {
  resource: string;
  documentedInApiary: boolean;
  read: ReadAvailability;
  write: WriteAvailability;
  notes?: string;
}

export const SUPERLOGICA_ENDPOINTS: SuperlogicaEndpointMeta[] = [
  // --- Documentados no Apiary (CRUD) ---
  { resource: "contratos", documentedInApiary: true, read: "read", write: "crud-documented", notes: "GET aceita comDadosDosProprietarios/Inquilinos/Imoveis e comStatus." },
  { resource: "imoveis", documentedInApiary: true, read: "read", write: "crud-documented" },
  { resource: "proprietarios", documentedInApiary: true, read: "read", write: "crud-documented" },
  { resource: "locatarios", documentedInApiary: true, read: "read", write: "crud-documented" },
  { resource: "fiadores", documentedInApiary: true, read: "read", write: "crud-documented" },
  { resource: "corretores", documentedInApiary: true, read: "read", write: "crud-documented" },
  { resource: "administradoras", documentedInApiary: true, read: "read", write: "crud-documented" },
  { resource: "seguradoras", documentedInApiary: true, read: "read", write: "crud-documented" },
  { resource: "servicos", documentedInApiary: true, read: "read", write: "crud-documented" },
  { resource: "cobrancas", documentedInApiary: true, read: "read", write: "crud-documented", notes: "Traz liquidação, PIX QR, 2ª via, multa/juros." },
  { resource: "imoveisdespesa", documentedInApiary: true, read: "read", write: "crud-documented", notes: "Despesas do contrato/imóvel." },

  // --- NÃO documentados no Apiary, mas REAIS (confirmados ao vivo) ---
  { resource: "repasses", documentedInApiary: false, read: "read", write: "unconfirmed", notes: "Repasse ao proprietário: status, txAdm, split, garantido, NF, liquidação/crédito." },
  { resource: "despesas", documentedInApiary: false, read: "read", write: "unconfirmed", notes: "Razão financeiro completo (repasses/movimentações embutidos)." },
  { resource: "dimob", documentedInApiary: false, read: "read", write: "unconfirmed", notes: "Dados da declaração DIMOB por contrato." },
  { resource: "seguros", documentedInApiary: false, read: "read", write: "unconfirmed", notes: "Apólices (≠ seguradoras)." },
  { resource: "pessoas", documentedInApiary: false, read: "read", write: "unconfirmed", notes: "Cadastro unificado de pessoas." },
  { resource: "filiais", documentedInApiary: false, read: "read", write: "none" },
  { resource: "gerentes", documentedInApiary: false, read: "read-empty-in-test", write: "none" },
  { resource: "usuarios", documentedInApiary: false, read: "read", write: "none" },
  { resource: "vistorias", documentedInApiary: false, read: "read-empty-in-test", write: "unconfirmed", notes: "Existe; sem vistorias na base de teste." },
  { resource: "pagamentos", documentedInApiary: false, read: "read-empty-in-test", write: "unconfirmed", notes: "Existe; vazio em todos os filtros testados." },
  { resource: "movimentacoes", documentedInApiary: false, read: "read-empty-in-test", write: "none", notes: "Existe; vazio na base de teste." },
  { resource: "relatorios", documentedInApiary: false, read: "param-required", write: "none", notes: "Renderiza relatório por id de formulário (Relatorios_Forms_<id>); ids válidos a confirmar." },
  { resource: "inadimplencia", documentedInApiary: false, read: "param-required", write: "none", notes: "Exige locatário(s); nome do parâmetro a confirmar com suporte." },

  // --- Ausentes (404 confirmado) — não há endpoint ---
  { resource: "reajustes", documentedInApiary: false, read: "absent", write: "none", notes: "Reajuste/índices: só campos no contrato." },
  { resource: "acordos", documentedInApiary: false, read: "absent", write: "none", notes: "Só id_acordo_aco referenciado em despesas/repasses." },
  { resource: "recibos", documentedInApiary: false, read: "absent", write: "none" },
  { resource: "nfse", documentedInApiary: false, read: "absent", write: "none", notes: "Só flags fl_emitirnotafiscal_con/dt_notafiscal_rep." },
  { resource: "garantias", documentedInApiary: false, read: "absent", write: "none", notes: "Dados embutidos no contrato + fiadores." },
];

/** Recursos prontos para consumo de leitura (read === "read"). */
export const SUPERLOGICA_READABLE = SUPERLOGICA_ENDPOINTS.filter(
  (e) => e.read === "read",
).map((e) => e.resource);
