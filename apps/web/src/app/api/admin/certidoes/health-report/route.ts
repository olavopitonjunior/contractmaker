import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  classifyJobBucket,
  buildHealthReport,
  type HealthJobLike,
} from "@/lib/certidoes/health-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/certidoes/health-report?hours=24
 *
 * Fase A (2026-06-01) — snapshot agregado da saúde das certidões, computado
 * ON-READ a partir de CertidaoJob (sem tabela de snapshot). Auth por
 * `Authorization: Bearer <CRON_SECRET>` (NÃO sessão — pensado pra consumo
 * headless: cron, rotina Claude da Fase B).
 *
 * SEM PII: retorna contagem por bucket, amostras (endpoint + resultCode +
 * categoria), e padrões `codigo_suspeito` (candidatos a bug). NÃO expõe nome
 * de parte, CPF, label nem mensagens que possam conter dados pessoais.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const hours = Math.min(Math.max(Number(req.nextUrl.searchParams.get("hours") ?? 24), 1), 168);
  const since = new Date(Date.now() - hours * 60 * 60_000);

  const rows = await prisma.certidaoJob.findMany({
    where: { createdAt: { gte: since }, status: { not: "replaced" } },
    select: {
      status: true,
      resultCode: true,
      errorMessage: true,
      resultData: true,
      retryCount: true,
      endpoint: true,
      dealId: true,
    },
  });

  const jobs: HealthJobLike[] = rows.map((r) => ({
    status: r.status,
    resultCode: r.resultCode,
    errorMessage: r.errorMessage,
    resultData: r.resultData,
    retryCount: r.retryCount,
  }));

  const report = buildHealthReport(jobs);

  // Padrões por bucket (sem PII): endpoint + resultCode + categoria + amostra
  // curta de mensagem genérica (truncada). Útil pra Fase B diagnosticar.
  const patterns: Record<string, { endpoint: string; resultCode: number | null; sample: string }[]> = {};
  const codeSuspectDeals = new Set<string>();
  rows.forEach((r, i) => {
    const bucket = classifyJobBucket(jobs[i]);
    if (bucket === "ok" || bucket === "em_voo") return;
    (patterns[bucket] ??= []);
    if (patterns[bucket].length < 8) {
      patterns[bucket].push({
        endpoint: r.endpoint,
        resultCode: r.resultCode,
        sample: (r.errorMessage ?? "").slice(0, 80),
      });
    }
    if (bucket === "codigo_suspeito" && r.dealId) codeSuspectDeals.add(r.dealId);
  });

  return NextResponse.json({
    windowHours: hours,
    generatedAt: new Date().toISOString(),
    total: report.total,
    byBucket: report.byBucket,
    actionable: report.actionable,
    patterns,
    codeSuspectDealCount: codeSuspectDeals.size,
  });
}
