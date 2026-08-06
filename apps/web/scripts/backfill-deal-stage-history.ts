// scripts/backfill-deal-stage-history.ts
// Reconstrói o PASSADO do DealStageHistory a partir do AuditLog
// DEAL_STAGE_CHANGE (plano 2026-08-06, PR 3.2). A migration set-based
// (20260806180000) já garante o intervalo ABERTO do stage atual de todo deal;
// este script tenta transformar a cadeia de audits em intervalos FECHADOS.
//
// Regras (decisão do dono: best-effort marcado como estimado, sem heurística):
//  - resolve stage por ID primeiro (fromStageId/toStageId/previousStageId dos
//    metadados novos e do mark-lost antigo); cai pra NOME dentro do pipeline
//    (metadados antigos gravavam fromStage/toStage ora como nome, ora como id);
//  - elo IRRESOLVÍVEL quebra a cadeia: o trecho vira um único intervalo
//    sintético reason='backfill_gap' (sem inventar stage);
//  - idempotente POR DEAL: apaga as linhas estimated=true e reinsere — NUNCA
//    toca linhas reais (estimated=false, escritas pelo moveDealStage);
//  - deal que JÁ tem linha real fechada (histórico vivo pós-3.1) tem o passado
//    reconstruído só ANTES da primeira linha real.
//
// Uso:
//   npx tsx apps/web/scripts/backfill-deal-stage-history.ts               # dry-run
//   npx tsx apps/web/scripts/backfill-deal-stage-history.ts --apply
//   npx tsx apps/web/scripts/backfill-deal-stage-history.ts --apply --orgId=<id>

import { prisma } from "@/lib/db/prisma";

const APPLY = process.argv.includes("--apply");
const ORG_ARG = process.argv.find((a) => a.startsWith("--orgId="));
const TARGET_ORG = ORG_ARG ? ORG_ARG.split("=")[1] : null;

interface StageRef {
  id: string;
  name: string;
  position: number;
  /** true quando o match foi por NOME (metadado antigo) — vira estimated. */
  byName: boolean;
}

interface Segment {
  stageId: string | null; // null = gap irresolvível
  stageName: string | null;
  stagePosition: number | null;
  fromStageId: string | null;
  enteredAt: Date;
  exitedAt: Date;
  reason: string;
  estimated: boolean;
  actorUserId: string | null;
}

function meta(m: unknown): Record<string, unknown> {
  return m && typeof m === "object" && !Array.isArray(m)
    ? (m as Record<string, unknown>)
    : {};
}

function resolveStage(
  raw: unknown,
  stages: Array<{ id: string; name: string; position: number }>
): StageRef | null {
  if (typeof raw !== "string" || !raw) return null;
  const byId = stages.find((s) => s.id === raw);
  if (byId) return { ...byId, byName: false };
  const byName = stages.find((s) => s.name === raw);
  if (byName) return { ...byName, byName: true };
  return null;
}

async function main() {
  console.log(
    APPLY ? "[backfill-stage-history] APPLY mode" : "[backfill-stage-history] DRY-RUN"
  );

  const deals = await prisma.deal.findMany({
    where: TARGET_ORG ? { pipeline: { orgId: TARGET_ORG } } : {},
    select: {
      id: true,
      stageId: true,
      stageEnteredAt: true,
      createdAt: true,
      kind: true,
      pipeline: {
        select: {
          orgId: true,
          kind: true,
          stages: { select: { id: true, name: true, position: true } },
        },
      },
    },
  });
  console.log(`${deals.length} deals no escopo`);

  let rebuilt = 0;
  let gaps = 0;
  let skippedNoAudit = 0;

  for (const deal of deals) {
    const stages = deal.pipeline.stages;
    const orgId = deal.pipeline.orgId;
    const kind = deal.kind || deal.pipeline.kind || "venda";

    // Limite superior da reconstrução: a 1ª linha REAL (estimated=false) — o
    // passado só é reconstruído antes dela; linhas reais nunca são tocadas.
    const firstReal = await prisma.dealStageHistory.findFirst({
      where: { dealId: deal.id, estimated: false },
      orderBy: { enteredAt: "asc" },
      select: { enteredAt: true, stageId: true },
    });
    const upperBound =
      firstReal?.enteredAt ?? deal.stageEnteredAt ?? deal.createdAt;

    const audits = await prisma.auditLog.findMany({
      where: {
        action: "DEAL_STAGE_CHANGE",
        resource: deal.id,
        resourceType: "Deal",
        createdAt: { lt: upperBound },
      },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true, userId: true, metadata: true },
    });
    if (audits.length === 0) {
      skippedNoAudit++;
      continue; // a migration set-based já cobre o intervalo aberto
    }

    // Constrói os segmentos fechados percorrendo a cadeia de audits.
    const segments: Segment[] = [];
    let cursor = deal.createdAt;
    let currentStage: StageRef | null = null;
    for (const a of audits) {
      const m = meta(a.metadata);
      const from =
        resolveStage(m.fromStageId, stages) ??
        resolveStage(m.previousStageId, stages) ??
        resolveStage(m.fromStage, stages);
      const to =
        resolveStage(m.toStageId, stages) ??
        resolveStage(m.toStage, stages) ??
        resolveStage(m.toStageName, stages);
      const stage = from ?? currentStage;
      if (stage) {
        segments.push({
          stageId: stage.id,
          stageName: stage.name,
          stagePosition: stage.position,
          fromStageId: null,
          enteredAt: cursor,
          exitedAt: a.createdAt,
          reason: "backfill",
          estimated: true,
          actorUserId: a.userId ?? null,
        });
      } else {
        // Trecho mudo — intervalo sintético sem stage não existe; registra gap.
        segments.push({
          stageId: null,
          stageName: null,
          stagePosition: null,
          fromStageId: null,
          enteredAt: cursor,
          exitedAt: a.createdAt,
          reason: "backfill_gap",
          estimated: true,
          actorUserId: null,
        });
      }
      cursor = a.createdAt;
      currentStage = to;
    }
    // Trecho final: do último audit até o limite superior, no stage corrente
    // (se conhecido e ≠ do stage do intervalo aberto/real — senão o intervalo
    // aberto/real já cobre).
    const boundaryStageId = firstReal?.stageId ?? deal.stageId;
    if (currentStage && currentStage.id !== boundaryStageId && cursor < upperBound) {
      segments.push({
        stageId: currentStage.id,
        stageName: currentStage.name,
        stagePosition: currentStage.position,
        fromStageId: null,
        enteredAt: cursor,
        exitedAt: upperBound,
        reason: "backfill",
        estimated: true,
        actorUserId: null,
      });
    }

    const usable = segments.filter((s) => s.stageId != null);
    const gapCount = segments.length - usable.length;
    gaps += gapCount;
    if (usable.length === 0) {
      skippedNoAudit++;
      continue;
    }

    console.log(
      `deal ${deal.id}: ${usable.length} intervalo(s) reconstruído(s), ${gapCount} gap(s)`
    );
    if (!APPLY) {
      rebuilt++;
      continue;
    }

    // Idempotência por deal (tx): apaga estimadas FECHADAS e reinsere. O
    // intervalo ABERTO estimado (migration/auto-cura) é preservado — apagá-lo
    // violaria o invariante de 1 aberto por deal se algo falhar no meio.
    await prisma.$transaction(async (tx) => {
      await tx.dealStageHistory.deleteMany({
        where: { dealId: deal.id, estimated: true, exitedAt: { not: null } },
      });
      for (const seg of usable) {
        await tx.dealStageHistory.create({
          data: {
            orgId,
            dealId: deal.id,
            kind,
            stageId: seg.stageId!,
            stageName: seg.stageName!,
            stagePosition: seg.stagePosition!,
            fromStageId: seg.fromStageId,
            enteredAt: seg.enteredAt,
            exitedAt: seg.exitedAt,
            durationSec: Math.max(
              0,
              Math.floor((seg.exitedAt.getTime() - seg.enteredAt.getTime()) / 1000)
            ),
            reason: seg.reason,
            estimated: true,
            actorUserId: seg.actorUserId,
          },
        });
      }
    });
    rebuilt++;
  }

  console.log(
    `\n${APPLY ? "Aplicado" : "Dry-run"}: ${rebuilt} deals reconstruídos, ${gaps} gaps, ${skippedNoAudit} sem audit utilizável (só intervalo aberto da migration)`
  );
}

main()
  .catch((err) => {
    console.error("ERROR:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
