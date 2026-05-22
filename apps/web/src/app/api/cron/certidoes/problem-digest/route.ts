import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { sendEmail } from "@/lib/email/client";

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
      endpoint: true,
      label: true,
      errorMessage: true,
      retryCount: true,
      maxRetries: true,
      resultCode: true,
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
          `• ${j.label} — ${j.endpoint} (cód ${j.resultCode ?? "-"}, ${j.retryCount}/${j.maxRetries} tentativas): ${j.errorMessage ?? "falha"}\n  ${baseUrl}/deals/${j.dealId}`
      );
      const text = `${orgJobs.length} certidão(ões) com problema não resolvido:\n\n${lines.join("\n\n")}\n\nPainel: ${baseUrl}/settings/certidoes`;
      const html = `<p><strong>${orgJobs.length} certidão(ões) com problema não resolvido.</strong></p><ul>${orgJobs
        .slice(0, 50)
        .map(
          (j) =>
            `<li>${j.label} — <code>${j.endpoint}</code> (cód ${j.resultCode ?? "-"}, ${j.retryCount}/${j.maxRetries} tentativas): ${j.errorMessage ?? "falha"} — <a href="${baseUrl}/deals/${j.dealId}">abrir negócio</a></li>`
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
