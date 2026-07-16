/**
 * Log estruturado de erros. Substitui os `console.error` soltos e, pior, os
 * `catch(() => {})` que engoliam falhas em silêncio nos pontos onde erro =
 * PERDA DE DADOS (persistência de chat/changelog, audit de webhook, download de
 * PDF assinado).
 *
 * Emite uma linha JSON por erro (scope + level + contexto sanitizado + stack
 * truncada) — parseável por qualquer coletor de logs. Sentry-ready: se
 * `SENTRY_DSN` estiver setado e `@sentry/nextjs` disponível, encaminha; sem
 * isso, cai no structured console (nunca lança — observabilidade não pode
 * quebrar o fluxo).
 */

type LogContext = Record<string, string | number | boolean | null | undefined>;

let sentryCapture: ((err: unknown, ctx?: LogContext) => void) | null = null;
let sentryTried = false;

async function getSentry(): Promise<typeof sentryCapture> {
  if (sentryTried) return sentryCapture;
  sentryTried = true;
  if (!process.env.SENTRY_DSN) return null;
  try {
    // Import dinâmico por variável — o pacote @sentry/nextjs é OPCIONAL e não
    // está nas deps; a string indireta evita que o bundler tente resolvê-lo em
    // build. Só resolve em runtime se alguém tiver instalado + setado o DSN.
    const mod = "@sentry/nextjs";
    const Sentry = (await import(/* webpackIgnore: true */ mod).catch(
      () => null
    )) as { captureException?: (e: unknown, o?: unknown) => void } | null;
    if (Sentry && typeof Sentry.captureException === "function") {
      sentryCapture = (err, ctx) =>
        Sentry.captureException!(err, ctx ? { extra: ctx } : undefined);
    }
  } catch {
    sentryCapture = null;
  }
  return sentryCapture;
}

/**
 * Registra um erro com escopo e contexto. Nunca lança.
 * @param scope identificador curto do ponto (ex.: "clicksign/signed-pdf")
 * @param err o erro capturado
 * @param context metadados não-sensíveis (ids, status) — NÃO passe PII
 */
export function logError(scope: string, err: unknown, context?: LogContext): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack?.slice(0, 1000) : undefined;
  try {
    console.error(
      JSON.stringify({
        level: "error",
        scope,
        message: message.slice(0, 500),
        ...(context ?? {}),
        stack,
      })
    );
  } catch {
    // Fallback se o context tiver algo não-serializável.
    console.error(`[${scope}]`, message);
  }
  // Forward best-effort pro Sentry (fire-and-forget).
  void getSentry().then((capture) => {
    if (capture) {
      try {
        capture(err, { scope, ...(context ?? {}) });
      } catch {
        /* no-op */
      }
    }
  });
}
