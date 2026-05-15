import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

/**
 * GET /api/certidoes — lista CertidaoJob da org com filtros.
 *
 * Usado por:
 *   - MCP tool `contractmaker__list_aging_certidoes` pra alertar Newton
 *     sobre certidões prestes a vencer (regra: 30 dias a partir de finishedAt)
 *   - UI futura de listagem global de certidões
 *
 * Filtros suportados:
 *   - status   CSV (pending,running,done,failed)
 *   - dealId   restringe a 1 deal
 *   - daysOld  retorna apenas certidões com finishedAt >= now - daysOld
 *              (ex: daysOld=25 retorna emitidas há mais de 25 dias,
 *              úteis pra alerta de vencimento próximo dos 30 dias)
 *   - limit    1-200, default 100
 *   - offset   default 0
 *
 * Scope: orgId do usuário autenticado (Bearer). Sem permission gate específico
 * pois certidões já são vinculadas a deals que o usuário pode ver via /pipeline.
 */
const querySchema = z.object({
  status: z.string().optional(),
  dealId: z.string().optional(),
  daysOld: z.coerce.number().int().min(0).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Query inválida" }, { status: 400 });
  }
  const q = parsed.data;

  const where: Record<string, unknown> = { orgId: ctx.orgId };
  if (q.status) {
    const statuses = q.status.split(",").map((s) => s.trim()).filter(Boolean);
    if (statuses.length > 0) where.status = { in: statuses };
  }
  if (q.dealId) where.dealId = q.dealId;
  if (q.daysOld !== undefined) {
    const cutoff = new Date(Date.now() - q.daysOld * 24 * 3600 * 1000);
    where.finishedAt = { lte: cutoff, not: null };
  }

  const [total, rows] = await Promise.all([
    prisma.certidaoJob.count({ where }),
    prisma.certidaoJob.findMany({
      where,
      orderBy: { finishedAt: "desc" },
      skip: q.offset,
      take: q.limit,
      select: {
        id: true,
        dealId: true,
        batchId: true,
        provider: true,
        endpoint: true,
        label: true,
        targetKind: true,
        targetIndex: true,
        status: true,
        resultCode: true,
        attachmentId: true,
        latencyMs: true,
        costCents: true,
        startedAt: true,
        finishedAt: true,
        expectedReadyAt: true,
        retryCount: true,
        createdAt: true,
      },
    }),
  ]);

  return NextResponse.json({
    total,
    offset: q.offset,
    limit: q.limit,
    rows,
  });
}
