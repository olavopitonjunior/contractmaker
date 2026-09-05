// Conector da API Superlógica Imobiliárias (somente leitura).
// Ver README.md desta pasta e docs/locacao/superlogica-api-benchmark.md.

export {
  slGet,
  slGetAll,
  slGetV2,
  slPostForm,
  slPostJson,
  slWriteV2,
  encodeForm,
  flattenFormFields,
  unwrapWriteResponse,
  toSuperlogicaDate,
  parseSuperlogicaDate,
  toNumber,
  toBool,
  SuperlogicaError,
  SuperlogicaDuplicateError,
  SUPERLOGICA_BASE_URL,
  SUPERLOGICA_V2_BASE_URL,
  MAX_ITENS_POR_PAGINA,
} from "./client";
export type {
  SuperlogicaCredentials,
  SuperlogicaResponse,
  SuperlogicaQuery,
  FormFields,
  FormValue,
} from "./client";
export {
  extractVendaSource,
  validarVendaSource,
  calcularComissao,
  buildPessoaPayload,
  buildCorretorPayload,
  buildImovelPayload,
  buildVendaPayload,
  imovelIdentificador,
  toApiDay,
  addDaysSP,
  formDateToApi,
  splitEqual,
  VendaExportBlockedError,
} from "./export/build-venda-payload";
export type {
  VendaSource,
  VendaSourceParty,
  VendaSourceComissionado,
  VendaSourceImovel,
  VendaExportDefaults,
  VendaDealInfo,
  ResolvedIds,
  ExportWarning,
  WarningCode,
  BuildVendaResult,
  ComissaoCalculada,
} from "./export/build-venda-payload";

export { createSuperlogicaClient } from "./resources";
export type { SuperlogicaClient } from "./resources";

export {
  SUPERLOGICA_ENDPOINTS,
  SUPERLOGICA_READABLE,
} from "./endpoints";
export type {
  SuperlogicaEndpointMeta,
  ReadAvailability,
  WriteAvailability,
} from "./endpoints";

export type * from "./types";
