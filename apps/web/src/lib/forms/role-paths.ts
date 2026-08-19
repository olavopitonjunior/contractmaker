import type { ParticipantRole } from "./participant-token";
import { categoryPathScope, parseTerceiroRole } from "./participant-category";
import { ROLE_ESTEIRA, resolveRoleVisibility } from "./participant-visibility";

/**
 * Allowlist de chaves top-level de `DadosContratoForm` que cada role pode
 * ler e escrever. Usado por:
 *
 *   - GET `/api/forms/participant/[subtoken]` — server pica `dataJson`
 *     pra mandar só o que o role enxerga.
 *   - PATCH `/api/forms/participant/[subtoken]` — server chama
 *     `deepMergeAtPaths(current, incoming, ROLE_PATHS[role])`.
 *   - `useAutoSave({ pathScope: ROLE_PATHS[role] })` no cliente.
 *
 * Decisão (revista em 2026-08): vendedor preenche `imoveis` (é quem tem
 * matrícula/IPTU em mãos); comprador preenche `compradores` E a etapa
 * Pagamento; locatário preenche `locatarios` + Garantia (inclusive indicar o
 * fiador). `comissao`, `fiscal`, `config`, `assinatura` e `testemunhas`
 * seguem EXCLUSIVOS do token principal — inalcançáveis por subtoken, por
 * construção (não existem em STEP_PATHS de participant-visibility.ts).
 */
// Desde 2026-08 os DEFAULTS derivam das etapas em
// lib/forms/participant-visibility.ts (STEP_PATHS × DEFAULT_ROLE_STEPS); o
// valor EFETIVO por org vem de resolveParticipantScope (config da org).
// Comissão/fiscal/testemunhas/assinatura/config seguem inalcançáveis por
// subtoken — não existem em STEP_PATHS.
export const ROLE_PATHS: Record<ParticipantRole, readonly string[]> =
  Object.fromEntries(
    (Object.keys(ROLE_ESTEIRA) as ParticipantRole[]).map((role) => [
      role,
      resolveRoleVisibility(role, {}).paths,
    ])
  ) as Record<ParticipantRole, readonly string[]>;

/**
 * Escopo de paths de QUALQUER role — nativo ou de terceiro.
 *
 * Os 5 nativos devolvem exatamente `ROLE_PATHS[role]` (mesma referência), o que
 * mantém o comportamento antigo byte a byte. Terceiro devolve um path ANINHADO
 * (`terceiros.<slug>`): a categoria escreve só na própria subárvore, sem
 * enxergar as outras categorias do mesmo formulário.
 *
 * Role desconhecido (categoria removida, link antigo) → `[]`: sem escopo, o
 * subtoken não lê nem escreve nada — falha fechada.
 */
export function resolveRolePaths(role: string): readonly string[] {
  const builtIn = ROLE_PATHS[role as ParticipantRole];
  if (builtIn) return builtIn;
  const slug = parseTerceiroRole(role);
  return slug ? categoryPathScope(slug) : [];
}

/** Chaves top-level distintas de um conjunto de paths (`a.b` → `a`). */
export function topKeysOfPaths(paths: readonly string[]): string[] {
  return Array.from(new Set(paths.map((p) => p.split(".")[0])));
}

/**
 * Filtra `dataJson` mantendo só as chaves permitidas pro role. Usado na
 * leitura via subtoken pra garantir que o cliente não recebe dados da
 * outra parte mesmo via inspeção do payload.
 */
export function filterDataJsonByRole(
  dataJson: Record<string, unknown>,
  role: ParticipantRole,
): Record<string, unknown> {
  const allow = new Set(ROLE_PATHS[role]);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(dataJson)) {
    if (allow.has(key)) out[key] = dataJson[key];
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Versão do filtro que entende paths de 2 níveis (`terceiros.<slug>`) além dos
 * top-level. Para paths sem ponto o resultado é idêntico ao
 * `filterDataJsonByRole` — é a mesma allowlist rasa.
 *
 * Profundidade máxima 2 de propósito: o namespace de terceiro é
 * `terceiros.<slug>` e nada mais fundo precisa ser recortado. Um path com mais
 * segmentos seria ignorado em silêncio, então `resolveRolePaths` nunca produz
 * um.
 */
export function filterDataJsonByPaths(
  dataJson: Record<string, unknown>,
  paths: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const path of paths) {
    const [top, sub] = path.split(".");
    if (!(top in dataJson)) continue;
    if (sub === undefined) {
      out[top] = dataJson[top];
      continue;
    }
    const branch = dataJson[top];
    if (!isPlainObject(branch)) continue;
    if (!(sub in branch)) continue;
    const existing = isPlainObject(out[top])
      ? (out[top] as Record<string, unknown>)
      : {};
    out[top] = { ...existing, [sub]: branch[sub] };
  }
  return out;
}

export interface NarrowResult {
  incoming: Record<string, unknown>;
  /** O que o cliente mandou fora do escopo — vira audit no caller. */
  rejectedPaths: string[];
}

/**
 * Recorta o payload do cliente ao escopo ANINHADO antes do merge atômico.
 *
 * `deepMergeAtPaths` só sabe allowlist de chave top-level: passar
 * `terceiros.<slug>` como `allowedTopKeys` rejeitaria o payload inteiro, e
 * passar `terceiros` deixaria uma categoria escrever na subárvore de outra.
 * Aqui o payload é reduzido a `{ terceiros: { <slug>: ... } }` e o merge segue
 * com `allowedTopKeys: ["terceiros"]` — o lock e a semântica de merge não mudam.
 *
 * Só é chamada quando o escopo tem path aninhado; os 5 papéis nativos seguem
 * pelo caminho de código antigo, sem passar por aqui.
 */
export function narrowIncomingToPaths(
  incoming: Record<string, unknown>,
  paths: readonly string[],
): NarrowResult {
  const rejectedPaths: string[] = [];
  const allowedTops = new Set(topKeysOfPaths(paths));
  const allowedSubs = new Map<string, Set<string>>();
  for (const path of paths) {
    const [top, sub] = path.split(".");
    if (sub === undefined) continue;
    const set = allowedSubs.get(top) ?? new Set<string>();
    set.add(sub);
    allowedSubs.set(top, set);
  }

  const out: Record<string, unknown> = {};
  for (const [top, value] of Object.entries(incoming)) {
    if (!allowedTops.has(top)) {
      rejectedPaths.push(top);
      continue;
    }
    const subs = allowedSubs.get(top);
    // Path top-level puro no escopo → passa inteiro (comportamento raso).
    if (!subs) {
      out[top] = value;
      continue;
    }
    if (!isPlainObject(value)) {
      rejectedPaths.push(top);
      continue;
    }
    const kept: Record<string, unknown> = {};
    for (const [sub, subValue] of Object.entries(value)) {
      if (subs.has(sub)) kept[sub] = subValue;
      else rejectedPaths.push(`${top}.${sub}`);
    }
    if (Object.keys(kept).length > 0) out[top] = kept;
  }
  return { incoming: out, rejectedPaths };
}
