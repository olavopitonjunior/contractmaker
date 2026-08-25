/**
 * Re-encadeamento do `/advance`.
 *
 * Uma invocação processa uma fatia e devolve. Para o lote andar sozinho, ela
 * dispara a PRÓXIMA invocação em `waitUntil` — a resposta já foi enviada, e a
 * função serverless continua viva o suficiente para o fetch sair.
 *
 * A chamada é interna: vai com o `CRON_SECRET` no header, o mesmo segredo que
 * `requireCronAuth` valida. Reusar a sessão do operador seria pior de duas
 * formas — o cookie viajaria para dentro de um worker, e a corrente morreria no
 * instante em que ele fizesse logout no meio de um acervo de 60 arquivos.
 *
 * Sem `CRON_SECRET` no ambiente não há corrente (nem cron): o run fica em pé,
 * com o estado íntegro no banco, e o próximo `/advance` da UI o retoma.
 */

export interface ChainAdvanceResult {
  scheduled: boolean;
  reason?: "no-cron-secret" | "fetch-failed";
}

/**
 * Origem desta request. Vem da URL do próprio handler porque é a única que
 * existe nos três ambientes que importam (Vercel, `next dev` e o teste da rota)
 * — `NEXTAUTH_URL` aponta pro domínio público, que num deploy de preview não é
 * o mesmo host que está executando.
 */
export function requestOrigin(req: { url: string }): string {
  return new URL(req.url).origin;
}

/** URL absoluta do `/advance` deste run, derivada da origem da request atual. */
export function advanceUrl(origin: string, runId: string): string {
  return `${origin.replace(/\/+$/, "")}/api/templates/ingest/runs/${runId}/advance`;
}

/**
 * Dispara a próxima fatia. Devolve a promessa para o caller passar ao
 * `waitUntil` — nunca rejeita: falhar em re-encadear é degradação (o cron
 * sweeper pega o run), não erro do request que o operador está esperando.
 */
export async function chainAdvance(
  origin: string,
  runId: string
): Promise<ChainAdvanceResult> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return { scheduled: false, reason: "no-cron-secret" };
  try {
    await fetch(advanceUrl(origin, runId), {
      method: "POST",
      headers: { "x-cron-secret": secret },
    });
    return { scheduled: true };
  } catch (err) {
    console.warn(`[ingestion] re-encadeamento do run ${runId} falhou:`, err);
    return { scheduled: false, reason: "fetch-failed" };
  }
}
