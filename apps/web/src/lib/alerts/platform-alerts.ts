/**
 * Motor de alerta da plataforma — generalização do único caminho proativo
 * que existia (o digest de certidões, que cobria uma integração só).
 *
 * O contrato: `reportPlatformAlert` é fire-and-forget e NUNCA lança — ele é
 * chamado de dentro de caminhos quentes (audit(), throw de budget, callback
 * de fallback) e um alerta quebrado não pode quebrar o que alertava.
 *
 * Anti-spam é a alma disto — um alerta que o dono aprende a ignorar é pior
 * que nenhum:
 *  - Dedupe por (kind, signature): repetição INCREMENTA count, não cria linha.
 *  - E-mail imediato só na 1ª ocorrência da assinatura, re-armando após
 *    REARM_MS (24h) — a 2ª à N-ésima do dia viram número no digest.
 *  - Teto global de imediatos por hora (MAX_IMMEDIATE_PER_HOUR): tempestade
 *    de falhas vira UM problema pro digest, não uma caixa de entrada lotada.
 *  - `notify: "digest"` nunca e-maila na hora — o cron diário agrupa.
 *
 * Destinatários: PlatformRole super_admin do BANCO (não env) — sobrevive a
 * troca de dono sem deploy.
 */

import { prisma } from "@/lib/db/prisma";
import { sendEmail } from "@/lib/email/client";
import { waitUntil } from "@vercel/functions";
import type { Prisma } from "@prisma/client";

export type AlertKind =
  | "support_signal"
  | "integration_failure"
  /** BLOQUEIO por teto (contrato/org/agente) — o usuário foi negado. */
  | "ai_budget"
  /** DEGRADAÇÃO: turn atendido no modelo de contingência. Kind próprio de
   *  propósito (review #234) — filtrar "bloqueou" junto com "degradou"
   *  conflataria severidades bem diferentes. */
  | "model_fallback";
export type AlertSeverity = "info" | "warning" | "critical";

export interface PlatformAlertInput {
  kind: AlertKind;
  /** Chave de dedupe DENTRO do kind. Estável entre ocorrências do mesmo problema. */
  signature: string;
  orgId?: string | null;
  severity?: AlertSeverity;
  /** Uma linha, legível por humano — vira assunto/linha do e-mail. */
  title: string;
  /** Detalhe pro corpo do digest. NUNCA inclua conteúdo não confiável sem truncar. */
  payload?: Record<string, unknown>;
  /** "immediate" e-maila na 1ª ocorrência (com re-arm/teto); "digest" só agrupa. */
  notify: "immediate" | "digest";
}

const REARM_MS = 24 * 60 * 60 * 1000;
const MAX_IMMEDIATE_PER_HOUR = 10;

/** E-mails dos super_admins — os destinatários de TODO alerta de plataforma. */
export async function alertRecipients(): Promise<string[]> {
  const roles = await prisma.platformRole.findMany({
    where: { role: "super_admin" },
    select: { user: { select: { email: true } } },
  });
  return roles
    .map((r) => r.user?.email)
    .filter((e): e is string => Boolean(e));
}

async function doReport(input: PlatformAlertInput): Promise<void> {
  const severity = input.severity ?? "warning";
  const now = new Date();

  // Upsert pela unique (kind, signature). Diferente do AgentProfile, aqui a
  // chave composta não tem coluna nullable — upsert nativo funciona.
  const row = await prisma.platformAlertEvent.upsert({
    where: { kind_signature: { kind: input.kind, signature: input.signature } },
    create: {
      kind: input.kind,
      signature: input.signature,
      orgId: input.orgId ?? null,
      severity,
      title: input.title,
      payload: (input.payload ?? undefined) as Prisma.InputJsonValue | undefined,
      lastSeenAt: now,
    },
    update: {
      count: { increment: 1 },
      lastSeenAt: now,
      severity,
      title: input.title,
      payload: (input.payload ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });

  if (input.notify !== "immediate") return;

  // Re-arm: já e-mailamos esta assinatura há menos de 24h → vira digest.
  // Risco ACEITO (review #234): duas primeiras-ocorrências simultâneas da
  // mesma assinatura podem ambas ler notifiedAt nulo e e-mailar em dobro —
  // o carimbo só acontece depois do envio. Janela rara, dano = 1 e-mail
  // duplicado, e o teto horário segura o caso patológico; serializar isto
  // numa transação não paga o que custa.
  if (row.notifiedAt && now.getTime() - row.notifiedAt.getTime() < REARM_MS) {
    return;
  }

  // Teto global por hora: tempestade não vira caixa lotada.
  const sentLastHour = await prisma.platformAlertEvent.count({
    where: { notifiedAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) } },
  });
  if (sentLastHour >= MAX_IMMEDIATE_PER_HOUR) return;

  const to = await alertRecipients();
  if (to.length === 0) return;

  const org = row.orgId
    ? await prisma.organization.findUnique({
        where: { id: row.orgId },
        select: { name: true },
      })
    : null;

  const result = await sendEmail({
    to,
    subject: `[imobpro] ${severity === "critical" ? "🔴" : "⚠️"} ${input.title}`,
    html: [
      `<p><strong>${escapeHtml(input.title)}</strong></p>`,
      `<p>Tenant: ${escapeHtml(org?.name ?? row.orgId ?? "plataforma")}<br/>`,
      `Tipo: ${row.kind} · Severidade: ${severity}<br/>`,
      `Ocorrências desta assinatura: ${row.count} (desde ${row.firstSeenAt.toISOString()})</p>`,
      input.payload
        ? `<pre>${escapeHtml(JSON.stringify(input.payload, null, 2).slice(0, 2000))}</pre>`
        : "",
      `<p style="color:#888">Repetições nas próximas 24h vão pro digest diário, não pra sua caixa. Detalhe em /admin/metrics → Auditoria.</p>`,
    ].join("\n"),
  });

  // Marca notifiedAt SÓ se o e-mail saiu — sendEmail não lança, devolve ok.
  if (result.ok) {
    await prisma.platformAlertEvent.update({
      where: { id: row.id },
      data: { notifiedAt: now },
    });
  }
}

/**
 * Fire-and-forget. Nunca lança; usa waitUntil pra sobreviver ao freeze da
 * função serverless (mesma razão do recordAIUsage).
 */
export function reportPlatformAlert(input: PlatformAlertInput): void {
  const p = doReport(input).catch((err) => {
    console.error("[platform-alerts] report falhou:", err);
  });
  try {
    waitUntil(p);
  } catch {
    void p;
  }
}

/** Só pra teste: a versão awaitável do report (o público é fire-and-forget). */
export const __doReportForTests = doReport;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
