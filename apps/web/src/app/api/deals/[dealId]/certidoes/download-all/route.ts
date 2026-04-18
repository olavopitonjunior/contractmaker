/**
 * I.2 (Phase I, 2026-04-18) — alias de `/certidoes/zip` para a URL
 * `/certidoes/download-all` que o QA 2026-04-18 esperava. Retornava 503
 * por rota inexistente. Re-exporta o mesmo handler; ambas URLs agora
 * funcionam e baixam o ZIP com a mesma lógica.
 */
export { GET } from "../zip/route";
export const runtime = "nodejs";
export const maxDuration = 120;
