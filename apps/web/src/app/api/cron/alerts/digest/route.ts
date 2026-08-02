import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/security/cron-auth";
import { prisma } from "@/lib/db/prisma";
import { isCronAllowedInStaging } from "@/lib/env/staging";
import { alertRecipients } from "@/lib/alerts/platform-alerts";
import { sendEmail } from "@/lib/email/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/alerts/digest — diário.
 *
 * Junta num e-mail só tudo que o motor de alerta acumulou e NÃO virou e-mail
 * imediato: os `notify: "digest"` (fallback de modelo, 👎 repetidos) e as
 * repetições dentro da janela de re-arm dos imediatos. É a metade "volume"
 * do anti-spam — o imediato cobre a 1ª ocorrência, o digest cobre o resto.
 *
 * "Pendente" = lastSeenAt nas últimas 24h E (nunca notificado OU a última
 * notificação é anterior à última ocorrência). Depois do envio, carimba
 * notifiedAt em tudo que entrou — sem carimbo, o mesmo item re-aparece
 * amanhã como se fosse novo.
 */
const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const cronDenied = requireCronAuth(req);
  if (cronDenied) return cronDenied;
  const path = "/api/cron/alerts/digest";
  if (!(await isCronAllowedInStaging(path))) {
    return NextResponse.json({ skipped: "staging-disabled", path });
  }

  const now = new Date();
  const since = new Date(now.getTime() - WINDOW_MS);

  // O filtro notifiedAt < lastSeenAt é coluna-contra-coluna — feito em JS
  // sobre a janela de 24h (dezenas de linhas no pior caso), não em SQL.
  const recentes = await prisma.platformAlertEvent.findMany({
    where: { lastSeenAt: { gte: since } },
    orderBy: [{ severity: "asc" }, { count: "desc" }],
    take: 200,
  });
  const pendentes = recentes
    .filter((p) => !p.notifiedAt || p.notifiedAt < p.lastSeenAt)
    .slice(0, 100);

  if (pendentes.length === 0) {
    return NextResponse.json({ sent: false, reason: "nada pendente" });
  }

  const to = await alertRecipients();
  if (to.length === 0) {
    return NextResponse.json({ sent: false, reason: "sem super_admin com email" });
  }

  const orgIds = [...new Set(pendentes.map((p) => p.orgId).filter(Boolean))] as string[];
  const orgs = orgIds.length
    ? await prisma.organization.findMany({
        where: { id: { in: orgIds } },
        select: { id: true, name: true },
      })
    : [];
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));

  const linhas = pendentes.map((p) => {
    const org = p.orgId ? orgName.get(p.orgId) ?? p.orgId : "plataforma";
    return `<tr><td>${esc(sevIcon(p.severity))}</td><td>${esc(org)}</td><td>${esc(
      p.title
    )}</td><td style="text-align:right">${p.count}×</td></tr>`;
  });

  const result = await sendEmail({
    to,
    subject: `[imobpro] Digest de alertas — ${pendentes.length} item(ns) nas últimas 24h`,
    html: [
      `<p>O que aconteceu e não virou e-mail imediato (repetições e sinais de baixo volume):</p>`,
      `<table cellpadding="6" style="border-collapse:collapse">`,
      `<tr style="text-align:left"><th></th><th>Tenant</th><th>Alerta</th><th>Ocorrências</th></tr>`,
      ...linhas,
      `</table>`,
      `<p style="color:#888">Detalhe por org e ação em /admin/metrics → Auditoria.</p>`,
    ].join("\n"),
  });

  if (result.ok) {
    await prisma.platformAlertEvent.updateMany({
      where: { id: { in: pendentes.map((p) => p.id) } },
      data: { notifiedAt: now },
    });
  }

  return NextResponse.json({
    sent: result.ok,
    items: pendentes.length,
    recipients: to.length,
    ...(result.ok ? {} : { error: "envio falhou — itens seguem pendentes" }),
  });
}

function sevIcon(sev: string): string {
  return sev === "critical" ? "🔴" : sev === "info" ? "ℹ️" : "⚠️";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
