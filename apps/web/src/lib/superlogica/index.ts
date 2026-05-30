// Conector da API Superlógica Imobiliárias (somente leitura).
// Ver README.md desta pasta e docs/locacao/superlogica-api-benchmark.md.

export {
  slGet,
  slGetAll,
  toSuperlogicaDate,
  parseSuperlogicaDate,
  toNumber,
  toBool,
  SuperlogicaError,
  SUPERLOGICA_BASE_URL,
  MAX_ITENS_POR_PAGINA,
} from "./client";
export type {
  SuperlogicaCredentials,
  SuperlogicaResponse,
  SuperlogicaQuery,
} from "./client";

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
