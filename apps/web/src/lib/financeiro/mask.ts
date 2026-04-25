/**
 * Mascara o nome do pagador para exibição pública em /pay.
 *
 * Estratégia:
 *  1. Remove tokens entre colchetes no início (ex: "[QA UX]", "[TESTE]") que
 *     seriam tags internas de usuários e não fazem parte do nome real.
 *  2. Remove pontuação isolada e colapsa espaços.
 *  3. Retorna "Primeiro Último-inicial." (ex: "Maria Aparecida de Souza" → "Maria S.").
 *  4. Se só houver uma palavra restante, retorna apenas ela (ex: "Maria" → "Maria").
 *  5. Fallback "Cliente" para entrada vazia/inválida.
 */
export function maskPayerName(fullName: string): string {
  if (!fullName) return "Cliente";

  // Remove tokens entre colchetes do início ("[QA UX] Maria" → "Maria")
  const stripped = fullName.replace(/^(\s*\[[^\]]*\]\s*)+/, "").trim();

  if (!stripped) return "Cliente";

  const parts = stripped.split(/\s+/).filter((p) => /[A-Za-zÀ-ÿ]/.test(p));
  if (parts.length === 0) return "Cliente";
  if (parts.length === 1) return parts[0];

  const first = parts[0];
  const last = parts[parts.length - 1];
  const initial = last[0]?.toUpperCase() ?? "";
  return initial ? `${first} ${initial}.` : first;
}
