/**
 * A janela dos botões de período, compartilhada pelos painéis.
 *
 * Módulo neutro (`lib/ui`) porque três telas usavam **cópias próprias** da
 * mesma conta — uso de IA, assinaturas e métricas de admin — e as cópias
 * carregavam o mesmo defeito. Consertar num lugar e deixar os outros é como
 * não consertar: o segundo painel vira o relato de bug do mês seguinte.
 */


/**
 * Fim do intervalo, a partir do `to` da query.
 *
 * ── O bug que isto conserta ──────────────────────────────────────────────
 *
 * `?to=2026-08-22` vira `new Date("2026-08-22")`, que é **meia-noite** — e
 * como o filtro é `lte`, o dia 22 inteiro ficava de fora. O painel de custo
 * NUNCA mostrava o gasto do dia corrente: os três presets (`7d`, `30d`,
 * `mtd`) mandam a data de hoje e recebiam de volta uma janela terminando
 * ontem. Uma chamada feita agora só aparecia amanhã.
 *
 * Achado em 22/08 durante o smoke do custo reportado, quando três linhas
 * recém-gravadas simplesmente não apareciam na tela. É antigo e silencioso:
 * o número exibido estava sempre certo para o intervalo pedido — só que o
 * intervalo não era o que o botão prometia.
 *
 * Data pura ("YYYY-MM-DD") passa a significar **o dia inteiro**, que é a
 * leitura natural de um intervalo de datas e o que o contrato da rota já
 * dizia. Timestamp completo é respeitado como veio.
 *
 * Ressalva honesta: o corte é em UTC. Para um tenant em UTC-3, uma chamada
 * feita depois das 21h cai no "dia seguinte" desta conta. É o mesmo critério
 * que o `from` sempre usou, e consertar isso de verdade exige o fuso do
 * tenant — que esta rota não conhece.
 */
export function limiteSuperior(param: string | null): Date {
  if (!param) return new Date();
  if (/^\d{4}-\d{2}-\d{2}$/.test(param)) {
    return new Date(`${param}T23:59:59.999Z`);
  }
  return new Date(param);
}

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

/**
 * O rótulo do período — o dia **UTC** de um instante, não o dia local dele.
 *
 * ── O bug que isto conserta ──────────────────────────────────────────────
 *
 * As rotas devolvem a janela como instante (`from.toISOString()`), e os dois
 * painéis renderizavam com `new Date(iso).toLocaleDateString("pt-BR")` — ou
 * seja, no fuso de quem olha. Num fuso NEGATIVO isso derruba a data em um dia
 * quando o instante é meia-noite UTC, que é exatamente o que o `from` é:
 *
 *     from = "2026-07-25T00:00:00.000Z"  →  "24/07/2026"   ✗ um dia atrás
 *     to   = "2026-08-23T23:59:59.999Z"  →  "23/08/2026"   ✓
 *
 * O `to` escapa porque vale o dia INTEIRO (ver `limiteSuperior`), e 23:59:59Z
 * ainda é o mesmo dia em UTC-3. É essa assimetria que escondeu o defeito: a
 * borda direita fica certa, então o rótulo parece plausível — e só a esquerda
 * mente.
 *
 * Visto em produção em 22/08, no painel de custo: rótulo `24/07 → 23/08` para
 * uma janela que o servidor calculou como `25/07 → 23/08`. Os NÚMEROS sempre
 * estiveram certos; quem mentia era a legenda deles.
 *
 * Não é regressão do #369. Antes dele o `to` também era meia-noite, as duas
 * bordas deslocavam juntas e o rótulo era uniformemente errado. O #369 deu ao
 * `to` o significado de dia inteiro e, de quebra, consertou a exibição da
 * direita — deixando a esquerda sozinha e a inconsistência à vista.
 *
 * ── Por que UTC, e não o fuso do leitor ──────────────────────────────────
 *
 * Porque é o que a janela É: `presetRange` decide em UTC e a rota filtra em
 * UTC. Um rótulo em horário local descreveria um intervalo que a query não
 * usou. A ressalva honesta continua a mesma do `limiteSuperior`: para um
 * tenant em UTC-3, uma chamada feita depois das 21h já conta no "dia seguinte"
 * desta conta. Resolver ISSO exige o fuso do tenant, que estas rotas não
 * conhecem, e é outro trabalho (ver issue #371). O que este conserto garante é
 * mais modesto e verificável: **o rótulo passa a dizer a janela que foi
 * realmente consultada.**
 *
 * Só para as BORDAS da janela. Instante de evento — `sentAt`, `closedAt`,
 * `createdAt` de um erro — continua em hora local, que é o certo para ele:
 * ali o leitor quer saber que horas eram para ELE quando aquilo aconteceu.
 */
export function rotuloDia(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}
