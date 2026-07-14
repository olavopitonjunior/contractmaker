// Detector de typo de DOMÍNIO de e-mail (estilo mailcheck). A validação de
// sintaxe (EMAIL_REGEX) não pega `yahool.com.br` nem `gmial.com` — são
// sintaticamente válidos, mas o domínio não existe e o e-mail dá bounce.
//
// Uso: `suggestEmailDomain("x@yahool.com.br")` → `"x@yahoo.com.br"`.
// Retorna `null` quando o domínio já é conhecido/correto, quando não há
// sugestão próxima o suficiente, ou quando o input não parece um e-mail.
//
// Função PURA — usada no client (diálogo de envio de assinatura). Sem deps.

/** Domínios de e-mail mais comuns no Brasil (provedores + corporativos globais). */
const COMMON_DOMAINS = [
  "gmail.com",
  "hotmail.com",
  "outlook.com",
  "outlook.com.br",
  "live.com",
  "yahoo.com",
  "yahoo.com.br",
  "icloud.com",
  "me.com",
  "bol.com.br",
  "uol.com.br",
  "terra.com.br",
  "globo.com",
  "ig.com.br",
  "hotmail.com.br",
];

/** Distância de Levenshtein entre duas strings. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // Uma linha só (rolling) pra economizar memória.
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deleção
        curr[j - 1] + 1, // inserção
        prev[j - 1] + cost // substituição
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Sugere a correção do domínio de um e-mail quando ele está a ≤2 edições de um
 * domínio comum (e não é exatamente um domínio conhecido). Retorna o e-mail
 * inteiro corrigido, ou `null` se não houver sugestão.
 *
 * Preserva a parte local (antes do `@`) verbatim — só o domínio é trocado.
 */
export function suggestEmailDomain(email: string): string | null {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1).toLowerCase();
  if (!domain.includes(".")) return null;

  // Domínio já é um dos conhecidos → nada a sugerir.
  if (COMMON_DOMAINS.includes(domain)) return null;

  let best: { domain: string; dist: number } | null = null;
  for (const candidate of COMMON_DOMAINS) {
    const dist = levenshtein(domain, candidate);
    if (best === null || dist < best.dist) {
      best = { domain: candidate, dist };
    }
  }

  // Limiar: até 2 edições. Evita sugerir para domínios corporativos legítimos
  // (ex.: "empresa.com.br" fica longe de qualquer provedor comum).
  if (!best || best.dist === 0 || best.dist > 2) return null;

  // Guard extra: não sugerir quando a diferença é grande relativa ao tamanho
  // (domínios muito curtos podem falso-positivar).
  if (best.domain.length <= 5 && best.dist > 1) return null;

  return `${local}@${best.domain}`;
}
