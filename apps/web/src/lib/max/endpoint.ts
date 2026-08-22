/**
 * Montagem das URLs do serviço do Max.
 *
 * Existe porque os três chamadores divergiram, e a divergência é invisível: o
 * `notify-trigger` fazia `${base}/notify`, o `push-org` fazia `${base}/api/orgs`
 * e o `admin-client` fazia `new URL("/api/admin/status", base)`. Como TODAS as
 * rotas do serviço vivem sob `/api/`, os dois primeiros só funcionam com
 * valores de `MAX_NOTIFY_URL` OPOSTOS entre si — com host puro o notify vira
 * 404, e com host terminando em `/api` o orgs vira `/api/api/orgs`. Nunca os
 * dois ao mesmo tempo.
 *
 * O modo como isso passou despercebido importa mais que o bug: cada endpoint
 * foi verificado com `curl` direto contra a URL certa, e não através do código
 * que a monta. O 404 resultante não é ruidoso — o `push-org` o traduz para
 * `delivered: false` e o `notify-trigger` para `status: "failed"`, que se
 * parecem com "o serviço está fora" em vez de "eu montei a URL errada".
 *
 * A forma canônica é `new URL(caminho, base)` com o caminho começando em `/`:
 * caminho absoluto DESCARTA o path da base, então os dois formatos convergem
 * para o mesmo lugar. É o que o `admin-client` já fazia por acaso.
 */

/**
 * Caminhos do serviço, sempre a partir da raiz.
 *
 * União fechada de propósito: é ela que impede o próximo chamador de inventar
 * a própria montagem de URL e reproduzir a divergência descrita acima. Rota
 * nova entra AQUI, e o compilador cobra.
 */
export type MaxPath =
  | "/api/notify"
  | "/api/orgs"
  | "/api/admin/status"
  | "/api/admin/conversations";

/**
 * @param base valor cru de `MAX_NOTIFY_URL` — com ou sem `/api`, com ou sem
 *   barra no fim.
 */
export function maxServiceUrl(base: string, path: MaxPath): URL {
  return new URL(path, base.replace(/\/+$/, ""));
}
