import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUGGESTED_INITIAL = [
  "Reembolso de matrícula",
  "Honorários advocatícios",
  "Taxa de avaliação",
  "Despesas cartoriais",
];

/**
 * GET /api/financeiro/categories?q=...
 *
 * Retorna últimos `categoryLabel` distintos da org (kind != commission)
 * + sugestões iniciais. Usado pelo Combobox de categoria no wizard avulso.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();

  const rows = await prisma.commissionCharge.groupBy({
    by: ["categoryLabel"],
    where: {
      orgId: ctx.orgId,
      kind: { not: "commission" },
      categoryLabel: q
        ? { contains: q, mode: "insensitive", not: null }
        : { not: null },
    },
    _count: true,
    orderBy: { _count: { categoryLabel: "desc" } },
    take: 10,
  });

  const fromDb = rows
    .map((r) => r.categoryLabel)
    .filter((s): s is string => !!s && s.trim().length > 0);

  const suggestions = q
    ? SUGGESTED_INITIAL.filter((s) =>
        s.toLowerCase().includes(q.toLowerCase())
      )
    : SUGGESTED_INITIAL;

  // Dedupe preservando ordem (DB primeiro)
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const s of [...fromDb, ...suggestions]) {
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(s);
  }

  return NextResponse.json({ categories: merged.slice(0, 10) });
}
