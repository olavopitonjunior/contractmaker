import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { audit, type AuditContext } from "@/lib/security/audit";
import {
  AGING_WARN_DAYS,
  AGING_DANGER_DAYS,
  isTerminalStageName,
} from "@/lib/pipeline/stage-config";

/**
 * MUTADOR ÚNICO de stage do Deal (plano 2026-08-06, Fase 3).
 *
 * Antes, 19 pontos espalhados faziam `deal.update({ stageId, stageEnteredAt })`
 * cada um com o próprio audit (metadata inconsistente: fromStage ora nome, ora
 * id). Agora todos passam por aqui, que numa TRANSAÇÃO:
 *   1. trava o deal (SELECT ... FOR UPDATE — dois movimentos concorrentes não
 *      abrem dois intervalos);
 *   2. no-op se já está no stage destino ({ moved: false });
 *   3. AUTO-CURA: deal sem intervalo aberto (pré-histórico) ganha um a partir
 *      de COALESCE(stageEnteredAt, createdAt) — os ~11 pontos de CRIAÇÃO de
 *      deal não precisam ser tocados;
 *   4. fecha o intervalo aberto (exitedAt + durationSec);
 *   5. abre o intervalo novo com SNAPSHOTS (stageName/position — stages são
 *      renomeáveis) e a política de SLA CONGELADA na entrada;
 *   6. atualiza o Deal (stageId, stageEnteredAt, slaWarnAt/slaDueAt; terminal
 *      zera os SLAs) + `dealData` extra do caller na MESMA transação;
 *   7. audita FORA da transação (pós-commit) com metadata PADRONIZADO.
 *
 * `tx` é a válvula pra callers que JÁ estão dentro de $transaction (auditoria
 * 2026-08: nenhum write-point migrado está; o convert CRIA deal em tx e fica
 * coberto pela auto-cura). Com `tx` fornecido, os passos 1-6 rodam nele; o
 * audit é fire-and-forget e dispara após o run — se a tx do caller der
 * rollback depois, o audit pode sobrar (mesmo trade-off do código anterior).
 */

export type MoveStageReason =
  | "drag"
  | "manual_update"
  | "archive"
  | "mark_lost"
  | "mark_signed"
  | "mark_commission_paid"
  | "reopen"
  | "aprovar_ficha"
  | "charge_created"
  | "superlogica_export"
  | "superlogica_liquidacao"
  | "charge_cancelled_regress"
  | "contract_approved"
  | "auto_commission_paid"
  | "auto_signed"
  | "contract_generation"
  | "convert"
  | "backfill"
  | "backfill_gap";

export interface MoveDealStageInput {
  dealId: string;
  toStageId: string;
  reason: MoveStageReason;
  actorUserId?: string | null;
  /** Redundante (derivável do pipeline) — passa quando o caller já tem. */
  orgId?: string;
  /** Campos EXTRAS do Deal a escrever na mesma transação (lostAt, título…).
   *  Unchecked (escalares) — o update principal já escreve stageId escalar. */
  dealData?: Prisma.DealUncheckedUpdateInput;
  /** Chaves extras mescladas ao metadata padronizado do audit. */
  auditMetadata?: Record<string, unknown>;
  /** Contexto do audit (ip/UA). Ausente → { orgId } resolvido. */
  auditCtx?: AuditContext;
  /** Transação do caller (válvula anti-aninhamento). */
  tx?: Prisma.TransactionClient;
}

export interface MoveDealStageResult {
  moved: boolean;
  fromStageId: string | null;
  fromStageName: string | null;
  toStageName: string;
  historyId: string | null;
  /** Org resolvida (via pipeline) — poupa o caller de re-buscar pro audit. */
  orgId: string;
}

type Db = Prisma.TransactionClient | PrismaClient;

/** Política congelada pro stage — defaults de código até o PR 3.3 (SlaPolicy). */
async function frozenPolicyFor(
  db: Db,
  orgId: string,
  kind: string,
  stageId: string,
  stageName: string
): Promise<{ warnDays: number | null; dangerDays: number | null }> {
  if (isTerminalStageName(stageName)) return { warnDays: null, dangerDays: null };
  // Override por org (tela /settings/sla — PR 3.5). Linha desabilitada =
  // stage sem SLA (não envelhece).
  const row = await db.slaPolicy.findFirst({
    where: { orgId, scope: "deal_stage", key: stageId },
    select: { warnDays: true, dangerDays: true, enabled: true },
  });
  if (row) {
    return row.enabled
      ? { warnDays: row.warnDays, dangerDays: row.dangerDays }
      : { warnDays: null, dangerDays: null };
  }
  return { warnDays: AGING_WARN_DAYS, dangerDays: AGING_DANGER_DAYS };
}

export async function moveDealStage(
  input: MoveDealStageInput
): Promise<MoveDealStageResult> {
  const run = async (db: Prisma.TransactionClient): Promise<MoveDealStageResult> => {
    // 1. Lock do deal — serializa movimentos concorrentes deste deal.
    await db.$queryRaw`SELECT "id" FROM "Deal" WHERE "id" = ${input.dealId} FOR UPDATE`;

    const deal = await db.deal.findUnique({
      where: { id: input.dealId },
      select: {
        id: true,
        stageId: true,
        stageEnteredAt: true,
        createdAt: true,
        kind: true,
        stage: { select: { id: true, name: true, position: true } },
        pipeline: { select: { orgId: true, kind: true } },
      },
    });
    if (!deal) throw new Error(`moveDealStage: deal ${input.dealId} não encontrado`);
    const orgId = input.orgId ?? deal.pipeline.orgId;
    const kind = deal.kind ?? deal.pipeline.kind ?? "venda";

    const toStage = await db.pipelineStage.findUnique({
      where: { id: input.toStageId },
      select: { id: true, name: true, position: true, pipeline: { select: { orgId: true } } },
    });
    if (!toStage) {
      throw new Error(`moveDealStage: stage ${input.toStageId} não encontrado`);
    }
    if (toStage.pipeline.orgId !== orgId) {
      throw new Error("moveDealStage: stage de outra organização");
    }

    // 2. Já está lá → no-op (mas ainda aplica dealData extra, se veio — o
    // caller pediu as duas coisas juntas e a metade de stage é que é no-op).
    if (deal.stageId === input.toStageId) {
      if (input.dealData && Object.keys(input.dealData).length > 0) {
        await db.deal.update({ where: { id: deal.id }, data: input.dealData });
      }
      return {
        moved: false,
        fromStageId: deal.stageId,
        fromStageName: deal.stage.name,
        toStageName: toStage.name,
        historyId: null,
        orgId,
      };
    }

    const now = new Date();

    // 3-4. Fecha o intervalo aberto; sem intervalo → AUTO-CURA (cria o do stage
    // atual a partir de stageEnteredAt/createdAt e fecha no mesmo passo).
    const open = await db.dealStageHistory.findFirst({
      where: { dealId: deal.id, exitedAt: null },
      select: { id: true, enteredAt: true },
    });
    if (open) {
      const durationSec = Math.max(
        0,
        Math.floor((now.getTime() - open.enteredAt.getTime()) / 1000)
      );
      await db.dealStageHistory.update({
        where: { id: open.id },
        data: { exitedAt: now, durationSec },
      });
    } else {
      const enteredAt = deal.stageEnteredAt ?? deal.createdAt;
      const durationSec = Math.max(
        0,
        Math.floor((now.getTime() - enteredAt.getTime()) / 1000)
      );
      await db.dealStageHistory.create({
        data: {
          orgId,
          dealId: deal.id,
          kind,
          stageId: deal.stageId,
          stageName: deal.stage.name,
          stagePosition: deal.stage.position,
          fromStageId: null,
          enteredAt,
          exitedAt: now,
          durationSec,
          reason: "backfill_gap",
          estimated: true,
        },
      });
    }

    // 5. Abre o intervalo novo com a política congelada.
    const policy = await frozenPolicyFor(db, orgId, kind, toStage.id, toStage.name);
    const history = await db.dealStageHistory.create({
      data: {
        orgId,
        dealId: deal.id,
        kind,
        stageId: toStage.id,
        stageName: toStage.name,
        stagePosition: toStage.position,
        fromStageId: deal.stageId,
        enteredAt: now,
        slaWarnDays: policy.warnDays,
        slaDangerDays: policy.dangerDays,
        reason: input.reason,
        actorUserId: input.actorUserId ?? null,
      },
    });

    // 6. Atualiza o deal — SLA materializado a partir da política congelada.
    const slaWarnAt =
      policy.warnDays != null ? new Date(now.getTime() + policy.warnDays * 86_400_000) : null;
    const slaDueAt =
      policy.dangerDays != null
        ? new Date(now.getTime() + policy.dangerDays * 86_400_000)
        : null;
    await db.deal.update({
      where: { id: deal.id },
      data: {
        stageId: toStage.id,
        stageEnteredAt: now,
        slaWarnAt,
        slaDueAt,
        ...(input.dealData ?? {}),
      },
    });

    return {
      moved: true,
      fromStageId: deal.stageId,
      fromStageName: deal.stage.name,
      toStageName: toStage.name,
      historyId: history.id,
      orgId,
    };
  };

  const result = input.tx
    ? await run(input.tx)
    : await prisma.$transaction(run);

  // 7. Audit pós-commit, metadata PADRONIZADO — as chaves ambíguas
  // fromStage/toStage (ora nome, ora id) saem de cena; `previousStageId` é o
  // alias que o reopen legado lê.
  if (result.moved) {
    await audit(
      input.auditCtx ?? { orgId: result.orgId, userId: input.actorUserId ?? null },
      {
      action: "DEAL_STAGE_CHANGE",
      result: "SUCCESS",
      resource: input.dealId,
      resourceType: "Deal",
        metadata: {
          // `kind` continua sendo a chave discriminadora que consumidores
          // legados leem — o caller pode sobrescrever via auditMetadata (ex.:
          // mark-lost grava kind:"lost", que o reopen pré-3.2 procura).
          kind: input.reason,
          reason: input.reason,
          fromStageId: result.fromStageId,
          fromStageName: result.fromStageName,
          toStageId: input.toStageId,
          toStageName: result.toStageName,
          previousStageId: result.fromStageId,
          previousStageName: result.fromStageName,
          historyId: result.historyId,
          ...(input.auditMetadata ?? {}),
        },
      }
    ).catch(() => {});
  }

  return result;
}
