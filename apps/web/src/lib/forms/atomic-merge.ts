import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { deepMergeAtPaths, type DeepMergeResult } from "./dataJson-merge";

/**
 * Merge atômico de `SalesForm.dataJson`.
 *
 * Os PATCHes públicos (token principal e subtoken por parte) faziam
 * read-modify-write não-atômico: liam o dataJson, mergeavam em memória e
 * regravavam o JSON inteiro. Dois escritores concorrentes (ex.: operador
 * editando `pagamento` no `/f/[token]` enquanto o vendedor salva `vendedores`
 * pelo `/f/p/[subtoken]`) mergeavam cada um sobre sua leitura stale — o último
 * write apagava o subtree do outro (lost update; janela = debounce de 1500ms
 * do auto-save + latência).
 *
 * Aqui a leitura acontece DENTRO de uma interactive transaction com
 * `SELECT ... FOR UPDATE`: o merge sempre parte do estado mais recente do
 * banco, serializado contra qualquer outro escritor que passe por este helper.
 * O payload do cliente continua fonte de verdade apenas da fatia dele
 * (`allowedTopKeys` pros subtokens); todo o resto vem da leitura fresca.
 *
 * Limite conhecido: dois humanos editando a MESMA chave top-level (ex.: admin
 * e vendedor mexendo ambos em `vendedores`) continuam last-writer-wins
 * naquela chave — é conflito real de edição, não lost update de dados
 * alheios. O lock garante que nenhuma OUTRA chave se perde.
 *
 * Nada de I/O externo dentro da transação: só o lock, o merge (CPU), o update
 * e as escritas irmãs de `also`. Validação, geração de contrato, notificações
 * e anexos ficam no caller, consumindo `finalData`.
 */

export interface AtomicMergeArgs {
  /** Localiza o form — os handlers têm token (rotas públicas) ou id. */
  where: { id: string } | { token: string };
  incoming: Record<string, unknown>;
  /** Allowlist top-level (ROLE_PATHS[role] nos subtokens). */
  allowedTopKeys?: readonly string[];
  /**
   * Pós-processamento síncrono do merged DENTRO do lock (ex.: dedupConjuges
   * no finalize) — roda sobre a leitura fresca, o que gravamos é o retorno.
   */
  transform?: (merged: Record<string, unknown>) => Record<string, unknown>;
  /** Campos extras do MESMO update (status, completedAt, lockedAt, privacy…). */
  extraData?: Omit<Prisma.SalesFormUncheckedUpdateInput, "dataJson">;
  /** Escritas irmãs na mesma transação (ex.: participant.completedAt). */
  also?: (tx: Prisma.TransactionClient) => Promise<void>;
}

export interface AtomicMergeResult extends DeepMergeResult {
  updated: {
    id: string;
    status: string;
    updatedAt: Date;
    completedAt: Date | null;
  };
  /** dataJson final gravado (pós-transform) — base do pós-processamento. */
  finalData: Record<string, unknown>;
}

export class FormNotFoundError extends Error {
  constructor() {
    super("FORM_NOT_FOUND");
    this.name = "FormNotFoundError";
  }
}

export async function mergeSalesFormDataJson(
  args: AtomicMergeArgs,
): Promise<AtomicMergeResult> {
  return prisma.$transaction(
    async (tx) => {
      // Row lock: serializa contra outros merges do mesmo form. A releitura
      // sob o lock é o que elimina o lost update.
      const rows =
        "id" in args.where
          ? await tx.$queryRaw<Array<{ id: string; dataJson: unknown }>>`
              SELECT "id", "dataJson" FROM "SalesForm"
              WHERE "id" = ${args.where.id} FOR UPDATE`
          : await tx.$queryRaw<Array<{ id: string; dataJson: unknown }>>`
              SELECT "id", "dataJson" FROM "SalesForm"
              WHERE "token" = ${args.where.token} FOR UPDATE`;
      if (rows.length === 0) throw new FormNotFoundError();

      const current = (rows[0].dataJson ?? {}) as Record<string, unknown>;
      const outcome = deepMergeAtPaths(
        current,
        args.incoming,
        args.allowedTopKeys,
      );
      const finalData = args.transform
        ? args.transform(outcome.merged)
        : outcome.merged;

      const updated = await tx.salesForm.update({
        where: { id: rows[0].id },
        data: {
          dataJson: finalData as Prisma.InputJsonValue,
          ...(args.extraData ?? {}),
        },
        select: { id: true, status: true, updatedAt: true, completedAt: true },
      });
      if (args.also) await args.also(tx);

      return {
        merged: outcome.merged,
        rejectedPaths: outcome.rejectedPaths,
        updated,
        finalData,
      };
    },
    // Auto-save de 2-4 clientes por form (debounce 1500ms): contenção mínima.
    // maxWait estourado → 500 → use-auto-save trata como transitório e
    // re-tenta no próximo keystroke.
    { timeout: 10_000, maxWait: 5_000 },
  );
}
