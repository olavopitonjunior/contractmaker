/**
 * Parser ÚNICO das respostas de erro das rotas de proposta → mensagem legível.
 *
 * Vivia inline no `run()` do ProposalActionBar; RowActions e os diálogos novos
 * (EnviarProprietarioDialog / concluir) precisam da MESMA tradução — sem isto
 * cada superfície inventava a própria ("[object Object]", "HTTP 422").
 * Client-safe (puro).
 */

export interface ProposalApiErrorBody {
  error?: string;
  message?: string;
  detail?: string;
  issues?: Array<{ reason?: string }>;
}

export function parseProposalApiError(
  body: ProposalApiErrorBody | null | undefined,
  httpStatus?: number
): string {
  const d = body ?? {};
  if (d.error === "preflight") {
    // `message` já vem humanizado do blockToResponse (quem tem cada pendência);
    // issues cruas são o fallback.
    if (d.message) return `Corrija antes de enviar: ${d.message}`;
    if (Array.isArray(d.issues)) {
      return (
        "Corrija antes de enviar: " +
        d.issues.map((i) => i.reason ?? "pendência").filter(Boolean).join(" · ")
      );
    }
    return "Corrija os dados dos signatários antes de enviar.";
  }
  if (d.error === "budget") return "Orçamento de assinaturas excedido.";
  if (typeof d.error === "string" && d.error) {
    return d.detail ? `${d.error} (${d.detail})` : d.error;
  }
  return httpStatus ? `HTTP ${httpStatus}` : "Erro na ação";
}
