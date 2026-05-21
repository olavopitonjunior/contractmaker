import type { Prisma } from "@prisma/client";
import { z } from "zod";

// Estados terminais que podem ser deletados em massa. Bulk-delete NUNCA toca
// em pending/fetching — esses ainda estão sendo escritos pelo executor.
export const DELETABLE = [
  "success",
  "failed",
  "failed_permanent",
  "skipped",
  "data_missing",
  "data_invalid",
  "informativo",
  "awaiting_portal",
  "duplicate_pending",
  "replaced",
] as const;

export const bulkDeleteSchema = z.object({
  // status      → apaga todos os jobs terminais de um status específico
  // batch       → apaga os jobs terminais de um batchId
  // replaced    → apaga só o histórico (status="replaced")
  // all_terminal→ apaga todos os jobs terminais do deal
  scope: z.enum(["status", "batch", "replaced", "all_terminal"]),
  status: z.string().optional(),
  batchId: z.string().optional(),
  withAttachments: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});

export type BulkDeleteInput = z.infer<typeof bulkDeleteSchema>;

/**
 * Pure helper — monta o `where` do deleteMany (sem dealId, adicionado pelo
 * caller) e valida a combinação scope+params. Função pura, testável sem
 * dependências de servidor.
 */
export function buildBulkDeleteWhere(
  input: BulkDeleteInput
): { where: Prisma.CertidaoJobWhereInput } | { error: string } {
  const terminal = { status: { in: [...DELETABLE] } };
  switch (input.scope) {
    case "all_terminal":
      return { where: terminal };
    case "replaced":
      return { where: { status: "replaced" } };
    case "status":
      if (!input.status) return { error: "scope=status exige `status`" };
      if (!DELETABLE.includes(input.status as (typeof DELETABLE)[number])) {
        return { error: `status "${input.status}" nao e deletavel` };
      }
      return { where: { status: input.status } };
    case "batch":
      if (!input.batchId) return { error: "scope=batch exige `batchId`" };
      return { where: { batchId: input.batchId, ...terminal } };
  }
}
