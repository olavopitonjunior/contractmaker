import {
  parseTerceiroRole,
  type ParticipantCategory,
} from "./participant-category";
import { findOrgParticipantCategory } from "./participant-category-repo";
import { resolveRolePaths, topKeysOfPaths } from "./role-paths";
import { resolveRoleSteps } from "./role-steps";

/**
 * Escopo efetivo de UM subtoken — o que a página pública e o PATCH precisam
 * saber sobre o papel, seja ele nativo ou de terceiro.
 *
 * Pros 5 nativos nada muda: `paths` é `ROLE_PATHS[role]` (chaves top-level),
 * `stepIndexes` é `ROLE_STEP_INDEXES[role]`, `category` é null. Pra terceiro,
 * `paths` é `["terceiros.<slug>"]`, `stepIndexes` é `[]` (a tela é o
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

export async function resolveParticipantScope(
  role: string,
  orgId: string,
): Promise<ParticipantScope> {
  const slug = parseTerceiroRole(role);
  const category = slug ? await findOrgParticipantCategory(orgId, slug) : null;
  const paths = resolveRolePaths(role);
  return {
    role,
    slug,
    category,
    paths,
    topKeys: topKeysOfPaths(paths),
    stepIndexes: resolveRoleSteps(role),
    nested: paths.some((p) => p.includes(".")),
  };
}
