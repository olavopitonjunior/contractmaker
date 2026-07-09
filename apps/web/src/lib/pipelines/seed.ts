import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";

export type PipelineKind = "venda" | "locacao";

// 7 stages canônicos do pipeline de VENDAS (espelha scripts/migrate-pipeline-stages.ts).
export const VENDA_STAGES: { name: string; color: string; position: number }[] = [
  { name: "Formulário", color: "#6366f1", position: 0 },
  { name: "Confecção de Contrato", color: "#f59e0b", position: 1 },
  { name: "Enviado para assinatura", color: "#3b82f6", position: 2 },
  { name: "Contrato assinado", color: "#0ea5e9", position: 3 },
  { name: "Cobrança emitida", color: "#a855f7", position: 4 },
  { name: "Comissão paga", color: "#22c55e", position: 5 },
  { name: "Negócio perdido", color: "#ef4444", position: 6 },
];

// 6 stages canônicos do pipeline de LOCAÇÃO (espelha scripts/seed-pipeline-locacao.ts;
// cor por NOME — o board traduz via STAGE_COLOR_HEX).
export const LOCACAO_STAGES: { name: string; color: string; position: number }[] = [
  { name: "Em Aprovação", color: "indigo", position: 0 },
  { name: "Formulário", color: "amber", position: 1 },
  { name: "Em contrato", color: "yellow", position: 2 },
  { name: "Assinado", color: "blue", position: 3 },
  { name: "Cobrança Gerada", color: "purple", position: 4 },
  { name: "ADM", color: "green", position: 5 },
];

const PIPELINE_NAME: Record<PipelineKind, string> = {
  venda: "Pipeline Principal",
  locacao: "Pipeline de Locação",
};

const STAGES: Record<PipelineKind, { name: string; color: string; position: number }[]> = {
  venda: VENDA_STAGES,
  locacao: LOCACAO_STAGES,
};

// Aceita tanto o client global quanto o client de uma transação (tx).
type PrismaLike = Prisma.TransactionClient | typeof prisma;

/**
 * Cria o pipeline do `kind` (+ stages canônicos) quando ainda não existe para a org.
 *
 * **Idempotente:** no-op se já houver um pipeline daquele kind (retorna
 * `created:false`). Seguro para rodar na criação da org, no enable de módulo
 * (fecha o gap "habilitar módulo não cria pipeline") e em backfill.
 *
 * O default de `Pipeline.kind` no schema é "venda"; passamos o kind explícito
 * para deixar a intenção clara e a query de existência precisa.
 */
export async function seedPipeline(
  orgId: string,
  kind: PipelineKind,
  client: PrismaLike = prisma
): Promise<{ created: boolean; pipelineId: string }> {
  const existing = await client.pipeline.findFirst({
    where: { orgId, kind },
    select: { id: true },
  });
  if (existing) return { created: false, pipelineId: existing.id };

  const pipeline = await client.pipeline.create({
    data: { orgId, name: PIPELINE_NAME[kind], kind },
  });
  await client.pipelineStage.createMany({
    data: STAGES[kind].map((s) => ({
      pipelineId: pipeline.id,
      name: s.name,
      color: s.color,
      position: s.position,
    })),
  });
  return { created: true, pipelineId: pipeline.id };
}
