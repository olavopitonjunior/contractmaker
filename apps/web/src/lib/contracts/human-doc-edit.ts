/**
 * Registra uma edição MANUAL (humana) feita direto no Google Doc, detectada pelo
 * webhook do Drive quando o ping NÃO é eco de uma edição programática (ver
 * lib/google/doc-edit-marker). Cria/atualiza um ContractChangeLog
 * `action:"human_doc_edit"`, `source:"user"` — que sobrevive à retention (não é
 * NOISE_ACTION) e aparece atribuído no painel Mudanças.
 *
 * Coalesce: pings de uma sessão de edição humana (dentro de COALESCE_MS) viram
 * UMA entry (refresca htmlAfter + createdAt, mantém htmlBefore). Throttle: não
 * re-exporta o Doc mais de uma vez por THROTTLE_MS (evita chamada Drive por ping).
 * Sem identidade — o Doc é compartilhado e o webhook não traz o editor.
 */

import type { Prisma } from "@prisma/client";

type ChangeLogRow = {
  id: string;
  createdAt: Date;
  htmlBefore: string | null;
};

// Slice do PrismaClient que usamos — o prisma real satisfaz; os testes passam um
// mock com `as never`.
type Db = {
  contractChangeLog: Pick<
    Prisma.ContractChangeLogDelegate,
    "findFirst" | "create" | "update"
  >;
};

export const HUMAN_DOC_EDIT_ACTION = "human_doc_edit";
const COALESCE_MS = 3 * 60 * 1000;
const THROTTLE_MS = 30 * 1000;
const SNAPSHOT_CAP = 50_000;

export interface RecordHumanDocEditDeps {
  db: Db;
  getDocText: (docId: string) => Promise<string>;
  now: () => Date;
}

export interface RecordHumanDocEditResult {
  outcome: "created" | "updated" | "throttled";
  changeLogId?: string;
}

export async function recordHumanDocEdit(
  deps: RecordHumanDocEditDeps,
  params: {
    contractId: string;
    googleDocId: string | null;
    details?: Record<string, unknown>;
  }
): Promise<RecordHumanDocEditResult> {
  const now = deps.now();

  // Entry recente do MESMO burst humano (pra coalescer)?
  const recent = (await deps.db.contractChangeLog.findFirst({
    where: {
      contractId: params.contractId,
      action: HUMAN_DOC_EDIT_ACTION,
      createdAt: { gt: new Date(now.getTime() - COALESCE_MS) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, htmlBefore: true },
  })) as ChangeLogRow | null;

  // Throttle: captura recente demais → só empurra o createdAt (mantém o burst
  // "vivo" pro coalesce) sem re-exportar o Doc.
  if (recent && now.getTime() - recent.createdAt.getTime() < THROTTLE_MS) {
    await deps.db.contractChangeLog.update({
      where: { id: recent.id },
      data: { createdAt: now },
    });
    return { outcome: "throttled", changeLogId: recent.id };
  }

  // Captura o estado ATUAL do Doc (best-effort — falha de Drive não bloqueia a
  // atribuição, só fica sem diff).
  let htmlAfter: string | null = null;
  if (params.googleDocId) {
    try {
      htmlAfter = (await deps.getDocText(params.googleDocId)).slice(0, SNAPSHOT_CAP);
    } catch {
      htmlAfter = null;
    }
  }

  if (recent) {
    // Coalesce: atualiza o burst. htmlAfter só sobrescreve se capturou (senão
    // mantém o anterior via undefined); mantém htmlBefore (início do burst).
    await deps.db.contractChangeLog.update({
      where: { id: recent.id },
      data: { htmlAfter: htmlAfter ?? undefined, createdAt: now },
    });
    return { outcome: "updated", changeLogId: recent.id };
  }

  // Novo burst. htmlBefore = último snapshot conhecido do Doc (estado ANTES desta
  // edição humana — normalmente o htmlAfter da última edição da IA/humana).
  const prev = (await deps.db.contractChangeLog.findFirst({
    where: { contractId: params.contractId, htmlAfter: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { htmlAfter: true },
  })) as { htmlAfter: string | null } | null;

  const created = await deps.db.contractChangeLog.create({
    data: {
      contractId: params.contractId,
      action: HUMAN_DOC_EDIT_ACTION,
      summary: "Edição manual no documento",
      source: "user",
      htmlBefore: prev?.htmlAfter ?? null,
      htmlAfter,
      details: { manual: true, ...(params.details ?? {}) },
    },
    select: { id: true },
  });
  return { outcome: "created", changeLogId: created.id };
}
