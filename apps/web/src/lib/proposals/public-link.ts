/**
 * Link público da proposta (/p/<token>) usado nos textos vinculantes do Aceite
 * (WhatsApp) e no comprovante durável.
 *
 * O fallback é PRODUÇÃO de propósito: NEXTAUTH_URL ausente é falha de
 * configuração, e a última linha de defesa deve apontar pro ambiente real —
 * um link de staging em documento vinculante é 404 pro destinatário e fica
 * gravado como prova. `||` (não `??`) cobre env var vazia.
 */
export function proposalPublicLink(token: string): string {
  const base = (process.env.NEXTAUTH_URL || "https://imobpro.ia.br").replace(/\/+$/, "");
  return `${base}/p/${token}`;
}
