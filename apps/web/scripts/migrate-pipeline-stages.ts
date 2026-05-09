/**
 * Script de upgrade idempotente do pipeline existente — renomeia "Assinatura"
 * pra "Enviado para assinatura", funde "Concluído" em "Comissão paga", e
 * insere as 3 novas stages do funil pós-assinatura. Roda contra a DB de prod
 * (single-tenant SHARED_ORG_ID).
 *
 * Dry-run default; --apply persiste.
 *
 * Stages finais (7):
 *   0 Formulário                 — existente
 *   1 Confecção de Contrato       — existente
 *   2 Enviado para assinatura     — renomeado de "Assinatura"
 *   3 Contrato assinado           — NOVO
 *   4 Cobrança emitida            — NOVO
 *   5 Comissão paga               — renomeado de "Concluído"
 *   6 Negócio perdido             — NOVO (terminal alternativo)
 *
 * Cuidado com @@unique([pipelineId, position]): atualizações que mudam
 * position são feitas em duas passadas (parking em positions altas
 * temporárias, depois posições finais).
 *
 * Uso:
 *   pnpm tsx apps/web/scripts/migrate-pipeline-stages.ts          # dry-run
 *   pnpm tsx apps/web/scripts/migrate-pipeline-stages.ts --apply  # persiste
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");

interface StageSpec {
  name: string;
  color: string;
  position: number;
  // Nome anterior (caso esta stage seja resultado de rename). Se um row com
  // este nome existir, será atualizado em vez de criar duplicata.
  previousName?: string;
}

const TARGET_STAGES: StageSpec[] = [
  { name: "Formulário", color: "#6366f1", position: 0 },
  { name: "Confecção de Contrato", color: "#f59e0b", position: 1 },
  { name: "Enviado para assinatura", color: "#3b82f6", position: 2, previousName: "Assinatura" },
  { name: "Contrato assinado", color: "#0ea5e9", position: 3 },
  { name: "Cobrança emitida", color: "#a855f7", position: 4 },
  { name: "Comissão paga", color: "#22c55e", position: 5, previousName: "Concluído" },
  { name: "Negócio perdido", color: "#ef4444", position: 6 },
];

const PARKING_OFFSET = 1000; // positions temporárias durante rebalance

interface MigrationOp {
  kind: "rename" | "create" | "update_meta" | "noop";
  stageId?: string;
  pipelineId: string;
  pipelineName: string;
  before?: { name: string; position: number; color: string | null };
  after: { name: string; position: number; color: string };
}

async function planMigration(): Promise<MigrationOp[]> {
  const ops: MigrationOp[] = [];
  const pipelines = await prisma.pipeline.findMany({
    include: { stages: { orderBy: { position: "asc" } } },
  });

  for (const pipeline of pipelines) {
    for (const target of TARGET_STAGES) {
      // Match por nome canônico OU nome anterior (rename pendente)
      const existing =
        pipeline.stages.find((s) => s.name === target.name) ??
        (target.previousName
          ? pipeline.stages.find((s) => s.name === target.previousName)
          : undefined);

      if (!existing) {
        ops.push({
          kind: "create",
          pipelineId: pipeline.id,
          pipelineName: pipeline.name,
          after: { name: target.name, position: target.position, color: target.color },
        });
        continue;
      }

      const needsRename = existing.name !== target.name;
      const needsPositionFix = existing.position !== target.position;
      const needsColorFix = existing.color !== target.color;

      if (!needsRename && !needsPositionFix && !needsColorFix) {
        ops.push({
          kind: "noop",
          stageId: existing.id,
          pipelineId: pipeline.id,
          pipelineName: pipeline.name,
          before: { name: existing.name, position: existing.position, color: existing.color },
          after: { name: target.name, position: target.position, color: target.color },
        });
        continue;
      }

      ops.push({
        kind: needsRename ? "rename" : "update_meta",
        stageId: existing.id,
        pipelineId: pipeline.id,
        pipelineName: pipeline.name,
        before: { name: existing.name, position: existing.position, color: existing.color },
        after: { name: target.name, position: target.position, color: target.color },
      });
    }
  }

  return ops;
}

async function applyMigration(ops: MigrationOp[]) {
  // Agrupa por pipeline pra rebalancear positions de forma segura
  const byPipeline = new Map<string, MigrationOp[]>();
  for (const op of ops) {
    const arr = byPipeline.get(op.pipelineId) ?? [];
    arr.push(op);
    byPipeline.set(op.pipelineId, arr);
  }

  for (const [pipelineId, pipelineOps] of byPipeline.entries()) {
    await prisma.$transaction(async (tx) => {
      // Passada 1: rebalanceia stages existentes pra positions de parking
      // (PARKING_OFFSET + index) pra liberar conflitos com @@unique([pipelineId, position]).
      const existingStages = await tx.pipelineStage.findMany({
        where: { pipelineId },
        orderBy: { position: "asc" },
      });
      for (let i = 0; i < existingStages.length; i++) {
        await tx.pipelineStage.update({
          where: { id: existingStages[i].id },
          data: { position: PARKING_OFFSET + i },
        });
      }

      // Passada 2: aplica updates e creates
      for (const op of pipelineOps) {
        if (op.kind === "noop") continue;
        if (op.kind === "create") {
          await tx.pipelineStage.create({
            data: {
              pipelineId,
              name: op.after.name,
              color: op.after.color,
              position: op.after.position,
            },
          });
        } else {
          // rename ou update_meta — atualiza row existente
          await tx.pipelineStage.update({
            where: { id: op.stageId! },
            data: {
              name: op.after.name,
              color: op.after.color,
              position: op.after.position,
            },
          });
        }
      }

      // Passada 3: limpa quaisquer stages "órfãs" que sobraram em parking
      // (não previstas no TARGET_STAGES). Não deveria acontecer no estado
      // canônico, mas se houver stage custom criada por usuário, mantemos
      // só log de aviso.
      const orphans = await tx.pipelineStage.findMany({
        where: { pipelineId, position: { gte: PARKING_OFFSET } },
      });
      for (const orphan of orphans) {
        const targetSlot = TARGET_STAGES.length + orphans.indexOf(orphan);
        console.warn(
          `[migrate-stages] Stage órfã em pipeline ${pipelineId}: "${orphan.name}" — movendo pra position ${targetSlot}. Considere remover manualmente se não usada.`
        );
        await tx.pipelineStage.update({
          where: { id: orphan.id },
          data: { position: targetSlot },
        });
      }
    });
  }
}

async function main() {
  console.log(`[migrate-stages] modo: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  const ops = await planMigration();

  let renames = 0;
  let creates = 0;
  let updates = 0;
  let noops = 0;

  for (const op of ops) {
    const tag = `[${op.pipelineName}]`;
    if (op.kind === "rename") {
      renames++;
      console.log(
        `${tag} RENAME stage ${op.stageId}: "${op.before!.name}" (pos ${op.before!.position}, ${op.before!.color}) → "${op.after.name}" (pos ${op.after.position}, ${op.after.color})`
      );
    } else if (op.kind === "create") {
      creates++;
      console.log(`${tag} CREATE stage "${op.after.name}" (pos ${op.after.position}, ${op.after.color})`);
    } else if (op.kind === "update_meta") {
      updates++;
      console.log(
        `${tag} UPDATE stage ${op.stageId}: pos ${op.before!.position}→${op.after.position}, color ${op.before!.color}→${op.after.color}`
      );
    } else {
      noops++;
    }
  }

  console.log(
    `\n[migrate-stages] Resumo: ${renames} renames, ${creates} creates, ${updates} updates, ${noops} no-ops.`
  );

  if (!APPLY) {
    console.log("[migrate-stages] Dry-run — re-execute com --apply pra persistir.");
    return;
  }

  if (renames + creates + updates === 0) {
    console.log("[migrate-stages] Nada a fazer. Idempotência confirmada.");
    return;
  }

  console.log("[migrate-stages] Aplicando…");
  await applyMigration(ops);
  console.log("[migrate-stages] OK.");
}

main()
  .catch((err) => {
    console.error("[migrate-stages] FALHA:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
