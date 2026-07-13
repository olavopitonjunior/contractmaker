import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { sendEmail } from "@/lib/email/client";
import { classifyJobBucket, type HealthBucket } from "@/lib/certidoes/health-monitor";
import { isCronAllowedInStaging } from "@/lib/env/staging";

// Rótulos PT-BR + ordem de prioridade dos buckets no resumo do digest.
const BUCKET_LABEL: Partial<Record<HealthBucket, string>> = {
  dado_faltante: "dado faltante (corrigir cadastro)",
  credito: "crédito/orçamento",
  config_endpoint: "endpoint não habilitado",
  codigo_suspeito: "possível bug (revisar)",
  failed_retryable: "falha transitória (re-tentando)",
  indisponivel: "portal indisponível (extração manual)",
  outro: "outro",
};

/** Resumo "X dado-faltante · Y crédito · …" por ordem de relevância. */
function bucketSummary(jobs: Array<Parameters<typeof classifyJobBucket>[0]>): string {
  const counts = new Map<HealthBucket, number>();
  for (const j of jobs) {
    const b = classifyJobBucket(j);
    if (b === "ok" || b === "em_voo") continue;
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([b, n]) => `${n} ${BUCKET_LABEL[b] ?? b}`)
    .join(" · ");
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/certidoes/problem-digest
 *
 * Cron diário — agrupa as certidões com falha terminal (failed_permanent /
 * failed) ainda NÃO incluídas num resumo (`problemNotifiedAt = null`), por org,
 * e envia UM e-mail resumo aos owners/admins. Marca `problemNotifiedAt` pra não
 * reavisar a mesma falha. Complementa o sino in-app (emitido em tempo real por
 * `reportCertidaoProblem`). Auth: `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  if (!(await isCronAllowedInStaging("/api/cron/certidoes/problem-digest"))) {
    return NextResponse.json({ skipped: "staging-disabled", path: "/api/cron/certidoes/problem-digest" });
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  const jobs = await prisma.certidaoJob.findMany({
    where: {
      status: { in: ["failed_permanent", "failed"] },
      problemNotifiedAt: null,
      orgId: { not: null },
      createdAt: { gte: since },
    },
    select: {
      id: true,
      orgId: true,
      dealId: true,
      leaseClientId: true,
      endpoint: true,
      label: true,
      errorMessage: true,
      retryCount: true,
      maxRetries: true,
      resultCode: true,
      status: true,
      resultData: true,
    },
    take: 500,
  });

  if (jobs.length === 0) {
    return NextResponse.json({ orgs: 0, jobs: 0, emails: 0 });
  }

  const byOrg = new Map<string, typeof jobs>();
  for (const j of jobs) {
    const list = byOrg.get(j.orgId!) ?? [];
    list.push(j);
    byOrg.set(j.orgId!, list);
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? "https://imobpro.ia.br";
  // Link do job: deal, cliente/prospect de locação, ou o painel de certidões
  // (evita o antigo /deals/null pra jobs sem deal — ad-hoc/cliente).
  const jobLink = (j: { dealId: string | null; leaseClientId: string | null }): string =>
    j.dealId
      ? `${baseUrl}/deals/${j.dealId}`
      : j.leaseClientId
        ? `${baseUrl}/locacao/pessoas/clientes/${j.leaseClientId}`
        : `${baseUrl}/settings/certidoes`;
  let emailsSent = 0;
  const notifiedIds: string[] = [];

  for (const [orgId, orgJobs] of byOrg) {
    const owners = await prisma.orgMembership.findMany({
      where: { orgId, role: { in: ["owner", "admin"] } },
      select: { user: { select: { email: true } } },
    });
    const emails = owners
      .map((o) => o.user?.email)
      .filter((e): e is string => !!e);

    if (emails.length > 0) {
      const lines = orgJobs.slice(0, 50).map(
        (j) =>
          `• ${j.label} — ${j.endpoint} (cód ${j.resultCode ?? "-"}, ${j.retryCount}/${j.maxRetries} tentativas): ${j.errorMessage ?? "falha"}\n  ${jobLink(j)}`
      );
      const resumo = bucketSummary(orgJobs);
      const text = `${orgJobs.length} certidão(ões) com problema não resolvido.\nResumo: ${resumo}\n\n${lines.join("\n\n")}\n\nPainel: ${baseUrl}/settings/certidoes`;
      const html = `<p><strong>${orgJobs.length} certidão(ões) com problema não resolvido.</strong></p><p>Resumo: ${resumo}</p><ul>${orgJobs
        .slice(0, 50)
        .map(
          (j) =>
            `<li>${j.label} — <code>${j.endpoint}</code> (cód ${j.resultCode ?? "-"}, ${j.retryCount}/${j.maxRetries} tentativas): ${j.errorMessage ?? "falha"} — <a href="${jobLink(j)}">abrir</a></li>`
        )
        .join("")}</ul><p><a href="${baseUrl}/settings/certidoes">Abrir painel de certidões</a></p>`;
      const res = await sendEmail({
        to: emails,
        subject: `⚠️ ${orgJobs.length} certidão(ões) com problema`,
        html,
        text,
      });
      if (res.ok) emailsSent++;
    }
    // Marca como notificado mesmo sem owner-email — evita reprocessar/spamar.
    notifiedIds.push(...orgJobs.map((j) => j.id));
  }

  await prisma.certidaoJob.updateMany({
    where: { id: { in: notifiedIds } },
    data: { problemNotifiedAt: new Date() },
  });

  return NextResponse.json({ orgs: byOrg.size, jobs: jobs.length, emails: emailsSent });
}
