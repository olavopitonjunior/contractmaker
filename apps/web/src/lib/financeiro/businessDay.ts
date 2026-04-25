/**
 * Helpers de dia útil no Brasil.
 *
 * A Asaas ajusta automaticamente vencimentos caindo em fim de semana ou
 * feriado nacional para o próximo dia útil válido. Esta util permite que
 * a UI avise o usuário no momento da seleção, evitando surpresa silenciosa.
 *
 * Escopo: feriados nacionais (federais) fixos + Páscoa-derivados (Sexta
 * Santa, Corpus Christi, Carnaval). Não cobre feriados estaduais/municipais.
 */

const FEDERAL_FIXED: Array<[number, number, string]> = [
  [1, 1, "Confraternização Universal"],
  [4, 21, "Tiradentes"],
  [5, 1, "Dia do Trabalho"],
  [9, 7, "Independência"],
  [10, 12, "Nossa Senhora Aparecida"],
  [11, 2, "Finados"],
  [11, 15, "Proclamação da República"],
  [11, 20, "Consciência Negra"],
  [12, 25, "Natal"],
];

// Computus — domingo de Páscoa. Retorna Date em UTC (00:00).
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(d: Date, days: number): Date {
  const nd = new Date(d);
  nd.setUTCDate(nd.getUTCDate() + days);
  return nd;
}

function toKey(d: Date): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

function buildHolidayMap(year: number): Map<string, string> {
  const m = new Map<string, string>();
  for (const [month, day, name] of FEDERAL_FIXED) {
    m.set(toKey(new Date(Date.UTC(year, month - 1, day))), name);
  }
  const easter = easterSunday(year);
  m.set(toKey(addDays(easter, -48)), "Carnaval (segunda)");
  m.set(toKey(addDays(easter, -47)), "Carnaval (terça)");
  m.set(toKey(addDays(easter, -2)), "Sexta-feira Santa");
  m.set(toKey(addDays(easter, 60)), "Corpus Christi");
  return m;
}

const CACHE = new Map<number, Map<string, string>>();
function holidaysFor(year: number): Map<string, string> {
  let m = CACHE.get(year);
  if (!m) {
    m = buildHolidayMap(year);
    CACHE.set(year, m);
  }
  return m;
}

export interface BusinessDayCheck {
  isBusinessDay: boolean;
  reason?: "saturday" | "sunday" | "holiday";
  holidayName?: string;
  adjustedToISO?: string; // yyyy-mm-dd do próximo dia útil (se !isBusinessDay)
}

/**
 * Recebe "yyyy-mm-dd" e retorna se é dia útil. Se não for, inclui o próximo
 * dia útil que a Asaas provavelmente escolheria.
 */
export function checkBusinessDay(isoDate: string): BusinessDayCheck {
  const [y, mo, d] = isoDate.split("-").map(Number);
  if (!y || !mo || !d) return { isBusinessDay: true };
  const date = new Date(Date.UTC(y, mo - 1, d));
  const dow = date.getUTCDay();

  if (dow === 0) return { isBusinessDay: false, reason: "sunday", adjustedToISO: nextBusinessDay(date) };
  if (dow === 6) return { isBusinessDay: false, reason: "saturday", adjustedToISO: nextBusinessDay(date) };

  const holidayName = holidaysFor(y).get(toKey(date));
  if (holidayName) {
    return {
      isBusinessDay: false,
      reason: "holiday",
      holidayName,
      adjustedToISO: nextBusinessDay(date),
    };
  }
  return { isBusinessDay: true };
}

function nextBusinessDay(from: Date): string {
  let d = addDays(from, 1);
  while (true) {
    const dow = d.getUTCDay();
    const isHoliday = holidaysFor(d.getUTCFullYear()).has(toKey(d));
    if (dow !== 0 && dow !== 6 && !isHoliday) break;
    d = addDays(d, 1);
  }
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
