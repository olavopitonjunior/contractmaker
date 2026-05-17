/**
 * cron-window.ts — validateInWindow
 *
 * Rejeita cron expression cujo campo hora cai fora de 7h-22h (horário SP).
 * Usado por schedule_proactive_message pra blindar a janela operacional sem
 * deixar a decisão pro LLM.
 *
 * Aceita:
 *   "30 7 * * 1-5"     → hour=7    OK
 *   "0 9,15 * * 1-5"   → hours=[9,15] OK
 *   "0 7-22 * * *"     → hours=[7..22] OK
 *   6-field com seconds: "0 30 7 * * 1-5" — hour fica na position 2
 *
 * Rejeita:
 *   "0 * * * *"        → wildcard hora
 *   "* /2 * * * *"     → step value
 *   "0 6 * * *"        → hora=6
 *   "0 23 * * *"       → hora=23
 */
export function validateInWindow(cronExpr: string): { ok: boolean; reason?: string } {
  if (typeof cronExpr !== "string") {
    return { ok: false, reason: "cron deve ser string" };
  }
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length < 5 || parts.length > 6) {
    return { ok: false, reason: "cron deve ter 5 ou 6 campos" };
  }
  const hourField = parts.length === 6 ? parts[2] : parts[1];
  if (hourField === "*" || /\*\//.test(hourField) || /^\?$/.test(hourField)) {
    return {
      ok: false,
      reason: "wildcard/step no campo hora não permitido — especifique horas concretas",
    };
  }
  const hours: number[] = [];
  for (const seg of hourField.split(",")) {
    const s = seg.trim();
    if (/^\d+$/.test(s)) {
      hours.push(Number(s));
    } else {
      const m = s.match(/^(\d+)-(\d+)$/);
      if (!m) return { ok: false, reason: `formato de hora não suportado: ${s}` };
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (a > b) return { ok: false, reason: `range invertido: ${s}` };
      for (let h = a; h <= b; h++) hours.push(h);
    }
  }
  for (const h of hours) {
    if (h < 7 || h > 22) {
      return { ok: false, reason: `hora ${h} fora da janela 7-22 (São Paulo)` };
    }
  }
  return { ok: true };
}
