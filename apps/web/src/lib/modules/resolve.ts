import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { MODULE, type ModuleKey } from "./catalog";

/**
 * Discriminadores centrais venda/locação. Single source of truth para mapear entre
 * a CHAVE DE MÓDULO ("vendas"/"locacao") e o `Pipeline.kind`/`Deal.kind` do banco
 * (que é "venda" — SINGULAR — para vendas, "locacao" para locação).
 */

/** Módulo a partir de `Deal.kind`/`Pipeline.kind`. */
export function moduleForDealKind(kind: string | null | undefined): ModuleKey {
  return kind === "locacao" ? MODULE.LOCACAO : MODULE.VENDAS;
}

/** Módulo a partir de `SalesForm.schemaType` (ex.: "locacao_residencial_v1"). */
export function moduleForSchemaType(schemaType: string | null | undefined): ModuleKey {
  return schemaType?.startsWith("locacao") ? MODULE.LOCACAO : MODULE.VENDAS;
}

/** Mapeia a chave de módulo para o valor de `Pipeline.kind`/`Deal.kind` no banco. */
export function pipelineKind(module: ModuleKey): "venda" | "locacao" {
  return module === MODULE.LOCACAO ? "locacao" : "venda";
}

/**
 * Busca o pipeline de uma org SEMPRE filtrando por `kind` — evita o footgun de
 * `pipeline.findFirst({ where: { orgId } })` (sem kind), que pode retornar o
 * pipeline errado quando a org tem venda E locação.
 *
 * Aceita os mesmos `args` (include/select/orderBy) de `findFirst` para preservar
 * o shape esperado por cada call-site; o `where` é montado aqui (orgId + kind) e
 * mesclado com qualquer `where` adicional do chamador.
 */
export function getPipelineByKind<T extends Omit<Prisma.PipelineFindFirstArgs, "where">>(
  orgId: string,
  module: ModuleKey,
  args?: T & { where?: Prisma.PipelineWhereInput },
): Promise<Prisma.PipelineGetPayload<T> | null> {
  return prisma.pipeline.findFirst({
    ...args,
    where: { ...(args?.where ?? {}), orgId, kind: pipelineKind(module) },
  }) as Promise<Prisma.PipelineGetPayload<T> | null>;
}
