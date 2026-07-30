/**
 * Formatação de data/hora BR determinística — irmã de `money.ts::formatMoneyBR`,
 * criada pelo mesmo motivo: hidratação.
 *
 * O QUE QUEBRAVA
 * --------------
 * `date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })` (e
 * parentes) resolve DUAS coisas no runtime: (a) o fuso e (b) o PADRÃO de locale
 * (ordem dos campos, separadores, a "cola" entre data e hora). O (a) o repo já
 * fixava passando `timeZone: "America/Sao_Paulo"`. O (b) não dá pra fixar: o
 * padrão vem dos dados de CLDR embutidos no ICU, e o ICU do Node da Vercel NÃO é
 * o ICU do Chrome/Safari do usuário. A cola de data+hora do pt-BR mudou entre
 * revisões de CLDR (`{1} {0}` → `{1}, {0}`), então o servidor emitia
 * "28/07/2026 20:23" e o browser "28/07/2026, 20:23" — texto diferente em CADA
 * data da tela, que é hydration mismatch (React #418) e, no limite, faz o React
 * descartar o HTML do servidor e re-renderizar a raiz inteira no client (#423).
 *
 * A SOLUÇÃO
 * ---------
 * Montar a string À MÃO. O único trabalho delegado ao `Intl` é converter o
 * instante UTC nos campos numéricos do fuso de São Paulo — isso vem do banco de
 * fusos (tzdata), não dos padrões de locale, e é idêntico em qualquer runtime
 * atual. Nada de `dateStyle`/`timeStyle`/`toLocale*`: separador, ordem e
 * zero-padding são nossos.
 *
 * Offset fixo NÃO serve: `-03:00` só vale de 2019 pra cá (o Brasil aboliu o
 * horário de verão pelo Decreto 9.772/2019); datas anteriores sairiam com uma
 * hora a menos no verão. O offset fixo fica só como último recurso, se o runtime
 * não tiver suporte a fuso IANA.
 *
 * Ainda assim, a regra da casa é FORMATAR NO SERVIDOR e mandar string pronta pro
 * client component (é o que as páginas de proposta fazem). Estas funções serem
 * determinísticas é o cinto de segurança, não a estratégia.
 */

const SP_TIME_ZONE = "America/Sao_Paulo";

interface DateTimeParts {
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
}

/**
 * Formatter em `en-US` de propósito: só extraímos campos NUMÉRICOS via
 * `formatToParts`, então o locale não influencia o resultado — e `en-US` é o que
 * todo runtime tem, inclusive um Node compilado com `small-icu`.
 */
const spParts = (() => {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: SP_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    // Sanity check: runtime sem tzdata aceita o construtor e ignora o timeZone.
    fmt.formatToParts(new Date(0));
    return fmt;
  } catch {
    return null;
  }
})();

function partsOf(date: Date): DateTimeParts {
  if (spParts) {
    const map: Record<string, string> = {};
    for (const p of spParts.formatToParts(date)) {
      if (p.type !== "literal") map[p.type] = p.value;
    }
    if (map.day && map.month && map.year && map.hour && map.minute) {
      return {
        day: map.day,
        month: map.month,
        year: map.year,
        // `hourCycle: "h23"` deveria bastar, mas ICUs antigos devolvem "24" pra
        // meia-noite (bug do h24). Normaliza pra a string nunca depender disso.
        hour: map.hour === "24" ? "00" : map.hour,
        minute: map.minute,
      };
    }
  }
  // Fallback (runtime sem fusos IANA): UTC-3 fixo. Correto de 2019 pra cá.
  const shifted = new Date(date.getTime() - 3 * 3_600_000);
  return {
    day: String(shifted.getUTCDate()).padStart(2, "0"),
    month: String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    year: String(shifted.getUTCFullYear()),
    hour: String(shifted.getUTCHours()).padStart(2, "0"),
    minute: String(shifted.getUTCMinutes()).padStart(2, "0"),
  };
}

/** Aceita ISO string, Date ou epoch ms. Devolve null pro que não for data válida. */
export function toDate(input: string | number | Date | null | undefined): Date | null {
  if (input == null || input === "") return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "28/07/2026 20:23" (horário de São Paulo). `null` → o traço. */
export function formatDateTimeBR(
  input: string | number | Date | null | undefined,
  fallback = "—"
): string {
  const d = toDate(input);
  if (!d) return fallback;
  const p = partsOf(d);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/** "28/07/2026" (horário de São Paulo). */
export function formatDateBR(
  input: string | number | Date | null | undefined,
  fallback = "—"
): string {
  const d = toDate(input);
  if (!d) return fallback;
  const p = partsOf(d);
  return `${p.day}/${p.month}/${p.year}`;
}

/** "28/07" — compacto pra tabela. */
export function formatDayMonthBR(
  input: string | number | Date | null | undefined,
  fallback = "—"
): string {
  const d = toDate(input);
  if (!d) return fallback;
  const p = partsOf(d);
  return `${p.day}/${p.month}`;
}

export type DeadlineTone = "none" | "warn" | "danger";

export interface DeadlineInfo {
  /** Dias inteiros até o vencimento; negativo se venceu; `null` se não há prazo. */
  days: number | null;
  tone: DeadlineTone;
  /** Forma longa, pra tela de detalhe: "faltam 5d". */
  label: string;
  /** Forma curta, pra coluna de tabela: "5d". */
  shortLabel: string;
}

/**
 * Prazo relativo do "vale até". É RELATIVO A `now`, então NUNCA deve ser
 * calculado durante o render de um client component: server e client rodam em
 * instantes diferentes e o rótulo vira outro no meio da hidratação. Quem chama é
 * o server component, que passa o resultado pronto.
 */
export function deadlineBR(
  validUntil: string | number | Date | null | undefined,
  now: number = Date.now()
): DeadlineInfo {
  const d = toDate(validUntil);
  if (!d) return { days: null, tone: "none", label: "sem prazo", shortLabel: "—" };
  const days = Math.ceil((d.getTime() - now) / 86_400_000);
  if (days < 0) return { days, tone: "danger", label: "vencida", shortLabel: "vencida" };
  if (days === 0)
    return { days, tone: "danger", label: "vence hoje", shortLabel: "vence hoje" };
  return {
    days,
    tone: days <= 2 ? "warn" : "none",
    label: `faltam ${days}d`,
    shortLabel: `${days}d`,
  };
}
