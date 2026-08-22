/**
 * A janela dos botões de período, compartilhada pelos painéis.
 *
 * Módulo neutro (`lib/ui`) porque três telas usavam **cópias próprias** da
 * mesma conta — uso de IA, assinaturas e métricas de admin — e as cópias
 * carregavam o mesmo defeito. Consertar num lugar e deixar os outros é como
 * não consertar: o segundo painel vira o relato de bug do mês seguinte.
 */


export type RangePreset = "7d" | "30d" | "mtd" | "last_month";

/** `YYYY-MM-DD` de um instante, em UTC. */
function diaUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * As janelas dos botões, **calculadas em UTC e devolvidas já como string**.
 *
 * ── Por que UTC, e por que string ────────────────────────────────────────
 *
 * A versão anterior montava as datas em horário LOCAL
 * (`new Date(ano, mes, 1)`) e as serializava em UTC com `.toISOString()`.
 * Para um fuso negativo isso desloca o limite um dia, e o efeito era real:
 * em UTC-3, "Mês anterior" mandava `to = 2026-08-01`, o que — depois de o
 * `to` passar a valer o dia inteiro — engolia **o dia 1 de agosto inteiro**
 * dentro do total de julho. E "Mês atual" começava às 21h do último dia do
 * mês anterior.
 *
 * Devolver string em vez de `Date` elimina a conversão implícita: o que a
 * função decide é exatamente o que vai no fio, sem um `.slice(0,10)` no meio
 * do caminho para desfazer a conta.
 *
 * ── Por que 6 e 29, e não 7 e 30 ─────────────────────────────────────────
 *
 * Os dois extremos entram por completo — a janela é
 * `[from 00:00Z, to 23:59:59.999Z]` (ver `limiteSuperior` em `usage.ts`).
 * Com 7 dias para trás, "Últimos 7 dias" cobriria OITO dias-calendário. O
 * erro é herdado: antes o `to` era meia-noite e a conta fechava por
 * acidente, às custas de o dia corrente sumir.
 *
 * `agora` é injetável para o teste poder fixar a aritmética — a versão
 * anterior era testada por uma RÉPLICA da conta, que ficava verde mesmo
 * revertendo o conserto.
 */
export function presetRange(
  preset: RangePreset,
  agora: Date = new Date()
): { from: string; to: string } {
  const DIA = 24 * 60 * 60 * 1000;
  const hoje = diaUtc(agora);

  if (preset === "7d") return { from: diaUtc(new Date(agora.getTime() - 6 * DIA)), to: hoje };
  if (preset === "30d") return { from: diaUtc(new Date(agora.getTime() - 29 * DIA)), to: hoje };

  const ano = agora.getUTCFullYear();
  const mes = agora.getUTCMonth();

  if (preset === "mtd") {
    return { from: diaUtc(new Date(Date.UTC(ano, mes, 1))), to: hoje };
  }

  // last_month — `Date.UTC(ano, mes, 0)` é o último dia do mês ANTERIOR.
  return {
    from: diaUtc(new Date(Date.UTC(ano, mes - 1, 1))),
    to: diaUtc(new Date(Date.UTC(ano, mes, 0))),
  };
}
