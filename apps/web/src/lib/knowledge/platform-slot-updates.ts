/**
 * Descoberta de cláusula de slot atualizada na plataforma.
 *
 * Na GERAÇÃO, a cláusula da imobiliária sempre vence — a da plataforma só
 * preenche lacuna (`resolveClauseSlots`). Essa regra existe porque o conteúdo
 * do slot entra no contrato e congela no `dataJson`: uma atualização central
 * não pode reescrever contrato alheio em silêncio.
 *
 * O outro lado dessa moeda é o problema que este módulo resolve: sem nenhum
 * sinal, uma correção publicada centralmente — uma exigência legal nova, por
 * exemplo — nunca chega a quem tem cláusula própria, e ninguém descobre. Aqui
 * a imobiliária FICA SABENDO que existe versão mais recente; adotar continua
 * sendo decisão dela.
 */

import { prisma } from "@/lib/db/prisma";
import {
  SLOT_TAG_PREFIX,
  PROVIDER_TAG_PREFIX,
  CLAUSE_SLOT_KEYS,
} from "@/lib/templates/clause-slots";

export interface PlatformSlotUpdate {
  /** Cláusula da org que tem substituta mais nova na plataforma. */
  orgClauseId: string;
  platformClauseId: string;
  platformTitle: string;
  platformUpdatedAt: string;
  orgUpdatedAt: string;
}

type ClauseRow = {
  id: string;
  title: string;
  tags: string[];
  updatedAt: Date;
};

/**
 * Chave de EQUIVALÊNCIA entre cláusulas de slot: as tags que participam da
 * seleção, ordenadas.
 *
 * `slot:garantia` (qual slot) + `garantia:fiador` (qual opção do form) +
 * `provider:*` (qual garantidor). `cobertura:*` fica de fora — é metadado de
 * cláusula acessória e não seleciona nada (ver `rankSlotCandidates`); incluí-la
 * faria uma cobertura adicional parecer substituta da cláusula principal.
 */
export function slotSelectionKey(tags: string[] | null | undefined): string | null {
  const list = tags ?? [];
  const slot = list.find((t) => t.startsWith(SLOT_TAG_PREFIX));
  if (!slot) return null;
  const slotKey = slot.slice(SLOT_TAG_PREFIX.length);
  if (!(CLAUSE_SLOT_KEYS as readonly string[]).includes(slotKey)) return null;

  const valor = list.filter((t) => t.startsWith(`${slotKey}:`));
  const providers = list.filter((t) => t.startsWith(PROVIDER_TAG_PREFIX));
  return [slot, ...valor.sort(), ...providers.sort()].join("|");
}

/**
 * Cláusulas de slot da org que têm equivalente MAIS RECENTE na plataforma.
 *
 * Compara por `updatedAt`: se a da plataforma foi publicada/editada depois, há
 * o que mostrar. Empate não conta — só o que é estritamente mais novo.
 */
export async function findPlatformSlotUpdates(
  orgId: string
): Promise<PlatformSlotUpdate[]> {
  const base = {
    category: "clause",
    status: "approved",
    // Só a RAIZ: as filhas de um item chunkado herdam as mesmas tags.
    parentId: null,
    tags: { has: `${SLOT_TAG_PREFIX}${CLAUSE_SLOT_KEYS[0]}` },
  } as const;

  const [daOrg, daPlataforma] = await Promise.all([
    prisma.knowledgeItem.findMany({
      where: { ...base, orgId },
      select: { id: true, title: true, tags: true, updatedAt: true },
    }),
    prisma.knowledgeItem.findMany({
      where: { ...base, orgId: null },
      select: { id: true, title: true, tags: true, updatedAt: true },
    }),
  ]);

  if (daPlataforma.length === 0 || daOrg.length === 0) return [];

  // Por chave, a MAIS RECENTE da plataforma é a candidata.
  const melhorDaPlataforma = new Map<string, ClauseRow>();
  for (const p of daPlataforma) {
    const key = slotSelectionKey(p.tags);
    if (!key) continue;
    const atual = melhorDaPlataforma.get(key);
    if (!atual || p.updatedAt > atual.updatedAt) melhorDaPlataforma.set(key, p);
  }

  const out: PlatformSlotUpdate[] = [];
  for (const o of daOrg) {
    const key = slotSelectionKey(o.tags);
    if (!key) continue;
    const p = melhorDaPlataforma.get(key);
    if (!p || p.updatedAt <= o.updatedAt) continue;
    out.push({
      orgClauseId: o.id,
      platformClauseId: p.id,
      platformTitle: p.title,
      platformUpdatedAt: p.updatedAt.toISOString(),
      orgUpdatedAt: o.updatedAt.toISOString(),
    });
  }
  return out;
}
