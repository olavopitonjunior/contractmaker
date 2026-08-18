import { prisma } from "@/lib/db/prisma";
import {
  parseTerceiroRole,
  type ParticipantCategory,
} from "./participant-category";
import { findOrgParticipantCategory } from "./participant-category-repo";
import { resolveRolePaths, topKeysOfPaths } from "./role-paths";
import {
  parseParticipantVisibilityJson,
  resolveRoleVisibility,
  ROLE_ESTEIRA,
} from "./participant-visibility";
import type { ParticipantRole } from "./participant-token";

/**
 * Escopo efetivo de UM subtoken — o que a página pública e o PATCH precisam
 * saber sobre o papel, seja ele nativo ou de terceiro.
 *
 * Papéis NATIVOS: etapas e data-paths vêm da configuração de visibilidade da
 * org (`OrgFormSettings.participantVisibilityJson`, sanitizada por
 * `parseParticipantVisibilityJson`) com fallback nos defaults de
 * `participant-visibility.ts`. A config só escolhe etapas do catálogo
 * `GRANTABLE_STEPS`/`STEP_PATHS` — comissão/fiscal/testemunhas/assinatura/
 * config são inalcançáveis por construção.
 *
 * Terceiro: `paths` é `["terceiros.<slug>"]`, `stepIndexes` é `[]` (a tela é o
 * `TerceiroStep`, fora do wizard) e `category` traz as field defs.
 */
export interface ParticipantScope {
  role: string;
  /** Slug da categoria — null em papel nativo. */
  slug: string | null;
  /** Definição da categoria; null se nativo OU se a categoria sumiu da org. */
  category: ParticipantCategory | null;
  /** Escopo de leitura/escrita (pode ter path aninhado no terceiro). */
  paths: readonly string[];
  /** Chaves top-level correspondentes — é o que o merge atômico entende. */
  topKeys: string[];
  /** Steps do wizard; `[]` em terceiro. */
  stepIndexes: readonly number[];
  /** Escopo aninhado → o payload precisa ser recortado antes do merge. */
  nested: boolean;
}

async function loadVisibilityConfig(orgId: string) {
  const row = await prisma.orgFormSettings.findUnique({
    where: { orgId },
    select: { participantVisibilityJson: true },
  });
  return parseParticipantVisibilityJson(row?.participantVisibilityJson);
}

export async function resolveParticipantScope(
  role: string,
  orgId: string,
): Promise<ParticipantScope> {
  const slug = parseTerceiroRole(role);
  const category = slug ? await findOrgParticipantCategory(orgId, slug) : null;

  // Papel nativo: etapas/paths configuráveis por org (fallback = defaults).
  if (ROLE_ESTEIRA[role as ParticipantRole]) {
    const config = await loadVisibilityConfig(orgId);
    const { stepIndexes, paths } = resolveRoleVisibility(role, config);
    return {
      role,
      slug: null,
      category: null,
      paths,
      topKeys: topKeysOfPaths(paths),
      stepIndexes,
      nested: false,
    };
  }

  // Terceiro / desconhecido: comportamento de sempre (falha fechada).
  const paths = resolveRolePaths(role);
  return {
    role,
    slug,
    category,
    paths,
    topKeys: topKeysOfPaths(paths),
    stepIndexes: [],
    nested: paths.some((p) => p.includes(".")),
  };
}
