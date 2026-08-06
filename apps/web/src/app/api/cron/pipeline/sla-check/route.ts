import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireCronAuth } from "@/lib/security/cron-auth";
import { isCronAllowedInStaging } from "@/lib/env/staging";
import { emitNotification } from "@/lib/notifications/emit";
import {
  notifyDealEvent,
  stageChangeDedupeKey,
} from "@/lib/notifications/deal-events";

export const runtime = "nodejs";
export const maxDuration = 60;

const CRON_PATH = "/api/cron/pipeline/sla-check";

/**
 * SLA do pipeline (plano 2026-08-06, PR 3.6) — roda 1×/dia (11 UTC = 8h BRT).
 * Varre deals ATIVOS com `slaDueAt` vencido (materializado pelo moveDealStage/
 * recompute — zero date-math por linha) e avisa a operação:
 *
 *  - ≤ 5 estouros novos na org/dia → 1 sino `deal_sla_breached` por deal
 *    (batchId `deal-sla-{dealId}-{stageId}:{yyyymmdd BRT}` — re-execução no
 *    mesmo dia é no-op; dia seguinte re-avisa enquanto não resolver);
 *  - > 5 → 1 sino-DIGEST `deal_sla_digest` org-wide (não inunda o sino);
 *  - canais EXTERNOS (email/WhatsApp corretor/gerente) só se a org ligou o
 *    evento na matriz — default OFF (DEFAULT_EVENT_OVERRIDES). O motor
 *    notifyDealEvent tem OWNS_BELL=false pro evento: sino é daqui.
 *
 * Fora do DEFAULT_STAGING_CRON_ALLOWLIST de propósito: staging tem deals
 * sintéticos parados há meses — rodar lá viraria spam diário no sino do owner.
 *
 * Dia em America/Sao_Paulo (UTC-3 fixo) via stageChangeDedupeKey — bucketing
 * UTC dividiria a noite de trabalho às 21h BRT.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  if (!(await isCronAllowedInStaging(CRON_PATH))) {
    return NextResponse.json({ ok: true, skipped: "staging" });
  }

  const now = new Date();
  const DIGEST_THRESHOLD = 5;
  const SCAN_CAP = 500;

  const breached = await prisma.deal.findMany({
    where: {
      slaDueAt: { lt: now },
      lostAt: null,
      archivedAt: null,
    },
    orderBy: { slaDueAt: "asc" },
    take: SCAN_CAP,
    select: {
      id: true,
      title: true,
      stageId: true,
      slaDueAt: true,
      stage: { select: { name: true } },
      pipeline: { select: { orgId: true, kind: true } },
    },
  });

  const byOrg = new Map<string, typeof breached>();
  for (const deal of breached) {
    const list = byOrg.get(deal.pipeline.orgId) ?? [];
    list.push(deal);
    byOrg.set(deal.pipeline.orgId, list);
  }

  let bells = 0;
  let digests = 0;
  let external = 0;
  for (const [orgId, deals] of byOrg) {
    // yyyymmdd BRT do dedupe — mesmo bucket dos sinos individuais.
    const dayKey = stageChangeDedupeKey("x", now).split(":")[1];

    if (deals.length > DIGEST_THRESHOLD) {
      await emitNotification({
        orgId,
        type: "deal_sla_digest",
        title: `${deals.length} negócios atrasados (SLA)`,
        body: `${deals.length} negócios estouraram o prazo da etapa atual. Use o filtro "SLA: Atrasado" no pipeline pra revisar.`,
        linkUrl: "/pipeline?sla=atrasado",
        metadata: { count: deals.length, dealIds: deals.slice(0, 50).map((d) => d.id) },
        batchId: `sla-digest-${orgId}-${dayKey}`,
      });
      digests++;
    } else {
      for (const deal of deals) {
        const dealPath =
          deal.pipeline.kind === "locacao"
            ? `/locacao/deals/${deal.id}`
            : `/deals/${deal.id}`;
        await emitNotification({
          orgId,
          type: "deal_sla_breached",
          title: "Negócio atrasado (SLA)",
          body: deal.stage?.name
            ? `O negócio "${deal.title}" estourou o prazo da etapa "${deal.stage.name}".`
            : `O negócio "${deal.title}" estourou o prazo da etapa atual.`,
          linkUrl: dealPath,
          metadata: { dealId: deal.id, stageId: deal.stageId },
          batchId: `deal-sla-${deal.id}-${stageChangeDedupeKey(deal.stageId, now)}`,
          dealId: deal.id,
        });
        bells++;
      }
    }

    // Canais externos por deal (default OFF — o motor curto-circuita se a org
    // não ligou o evento). Await inline: cron tem tempo de sobra.
    for (const deal of deals) {
      await notifyDealEvent({
        dealId: deal.id,
        orgId,
        event: "deal_sla_breached",
        dedupeKey: stageChangeDedupeKey(deal.stageId, now),
        context: { stageName: deal.stage?.name ?? null },
      });
      external++;
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: breached.length,
    capped: breached.length === SCAN_CAP,
    orgs: byOrg.size,
    bells,
    digests,
    externalDispatches: external,
  });
}
