import { z } from "zod";

/** Filtros do audit log (Fase 1f) — reusado pelo GET e pelo export. */
export const auditQuerySchema = z.object({
  action: z.string().optional(),
  userId: z.string().optional(),
  result: z.enum(["SUCCESS", "FAILURE", "DENIED"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().trim().min(1).optional(), // free-text sobre action/resource/resourceType
  resourceType: z.string().optional(),
  entityId: z.string().optional(),
  impersonatedBy: z.string().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type AuditQuery = z.infer<typeof auditQuerySchema>;

/** Monta o `where` Prisma a partir dos filtros, sempre escopado por org. */
export function buildAuditWhere(orgId: string | null, p: AuditQuery) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { orgId };
  if (p.action) where.action = p.action;
  if (p.userId) where.userId = p.userId;
  if (p.result) where.result = p.result;
  if (p.resourceType) where.resourceType = p.resourceType;
  if (p.entityId) where.entityId = p.entityId;
  if (p.impersonatedBy) where.impersonatedBy = p.impersonatedBy;
  if (p.from || p.to) {
    where.createdAt = {};
    if (p.from) where.createdAt.gte = new Date(p.from);
    if (p.to) where.createdAt.lte = new Date(p.to);
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
