import { z } from "zod";
import { Prisma } from "@prisma/client";

/**
 * Filtros do log de auditoria (1f) — reusados pelo GET e pelo export CSV.
 *
 * `impersonatedBy` NÃO é coluna: o master carimba a impersonação dentro de
 * `AuditLog.metadata` (`{ impersonated, impersonatedBy, impersonationSessionId }`
 * — ver audit.ts). Filtramos por JSON path, sem migration de schema. `entityId`
 * do desenho original foi omitido pelo mesmo motivo (seria coluna nova).
 */
export const auditQuerySchema = z.object({
  action: z.string().optional(),
  userId: z.string().optional(),
  result: z.enum(["SUCCESS", "FAILURE", "DENIED"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  /** Busca livre (contains, case-insensitive) sobre action/resource/resourceType. */
  q: z.string().trim().min(1).optional(),
  resourceType: z.string().optional(),
  /** userId do admin que impersonava — casado via metadata->>'impersonatedBy'. */
  impersonatedBy: z.string().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type AuditQuery = z.infer<typeof auditQuerySchema>;

/** Monta o `where` Prisma a partir dos filtros, sempre escopado por org. */
export function buildAuditWhere(
  orgId: string | null,
  p: AuditQuery
): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = { orgId };
  if (p.action) where.action = p.action;
  if (p.userId) where.userId = p.userId;
  if (p.result) where.result = p.result;
  if (p.resourceType) where.resourceType = p.resourceType;
  if (p.from || p.to) {
    where.createdAt = {};
    if (p.from) where.createdAt.gte = new Date(p.from);
    if (p.to) where.createdAt.lte = new Date(p.to);
  }
  // Impersonação carimbada no metadata (sem coluna dedicada).
  if (p.impersonatedBy) {
    where.metadata = {
      path: ["impersonatedBy"],
      equals: p.impersonatedBy,
    };
  }
  if (p.q) {
    where.OR = [
      { action: { contains: p.q, mode: "insensitive" } },
      { resource: { contains: p.q, mode: "insensitive" } },
      { resourceType: { contains: p.q, mode: "insensitive" } },
    ];
  }
  return where;
}

/** Lê o admin impersonador de um metadata de AuditLog (ou null). */
export function impersonatedByFromMetadata(metadata: unknown): string | null {
  if (metadata && typeof metadata === "object" && "impersonatedBy" in metadata) {
    const v = (metadata as Record<string, unknown>).impersonatedBy;
    return typeof v === "string" ? v : null;
  }
  return null;
}
