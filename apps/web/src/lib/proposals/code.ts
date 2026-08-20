/**
 * Código humano da proposta — "PROP-2026-0042".
 *
 * Antes disto o "número" da proposta era `id.slice(-8)`, o sufixo do cuid:
 * não sequencial, não legível e sem relação com a ordem de criação. O código
 * passa a ser sequencial por (org, ano), com o ano em BRT.
 *
 * NÃO é client-safe: `allocateProposalCode` fala com o banco. Componentes
 * devem importar apenas `proposalNumero`/`formatProposalCode` — as duas são
 * puras (ver a nota no topo de `proposalNumero`).
 */

import { yearBR } from "@/lib/format/datetime";

/** Prefixo do código. Trocar aqui muda só as propostas NOVAS. */
const CODE_PREFIX = "PROP";

/** Dígitos da parte sequencial. `9999` não estoura — o padStart só para de
 *  preencher e o código cresce (PROP-2026-10000), continuando ordenável por
 *  ano e único. */
const SEQ_DIGITS = 4;

/** Cliente Prisma ou transação — o alocador serve os dois. */
type Db = {
  $queryRaw<T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
};

/** "PROP-2026-0042". */
export function formatProposalCode(year: number, seq: number): string {
  return `${CODE_PREFIX}-${year}-${String(seq).padStart(SEQ_DIGITS, "0")}`;
}

/** Escopo do contador em `OrgSequence`. */
export function proposalSequenceScope(year: number): string {
  return `proposal:${year}`;
}

/**
 * Aloca o próximo código da org no ano corrente (BRT).
 *
 * O incremento é um statement ÚNICO: o Postgres serializa `ON CONFLICT DO
 * UPDATE` na row, então dois creates simultâneos recebem valores distintos.
 * `SELECT MAX(code) + 1` teria a corrida clássica — os dois leem o mesmo
 * máximo, os dois formatam o mesmo código, e o `@@unique([orgId, code])` acaba
 * derrubando um deles com um P2002 sem explicação.
 *
 * Chamar SEMPRE dentro da mesma transação do `proposal.create`: se a criação
 * falhar, o rollback devolve o contador e nenhum número fica queimado (o que
 * abriria buracos na sequência).
 */
export async function allocateProposalCode(
  db: Db,
  orgId: string,
  now: Date = new Date()
): Promise<string> {
  const year = yearBR(now);
  const scope = proposalSequenceScope(year);

  const rows = await db.$queryRaw<{ value: number }[]>`
    INSERT INTO "OrgSequence" ("orgId", "scope", "value", "updatedAt")
    VALUES (${orgId}, ${scope}, 1, CURRENT_TIMESTAMP)
    ON CONFLICT ("orgId", "scope") DO UPDATE
      SET "value" = "OrgSequence"."value" + 1,
          "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "value"
  `;

  const value = rows[0]?.value;
  if (typeof value !== "number") {
    throw new Error("Falha ao alocar o código da proposta.");
  }
  return formatProposalCode(year, value);
}

/**
 * Número exibível da proposta. PURA e client-safe.
 *
 * O fallback pro sufixo do id cobre a janela em que uma proposta antiga ainda
 * não recebeu código (o backfill da migration cobre todas, mas ler direto
 * `code!` transformaria qualquer lacuna num "undefined" em documento).
 *
 * `code` é OBRIGATÓRIO no tipo (ainda que nullable) de propósito: como opcional,
 * um `select` do Prisma que esquecesse a coluna compilava e caía no fallback em
 * silêncio — e o número no comprovante de aceite passava a divergir do que foi
 * enviado ao cliente. Exigir a chave faz o compilador apontar o select faltante.
 */
export function proposalNumero(proposal: {
  code: string | null;
  id: string;
}): string {
  return proposal.code ?? proposal.id.slice(-8);
}
