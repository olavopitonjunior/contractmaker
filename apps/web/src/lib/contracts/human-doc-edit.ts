import type { Prisma } from "@prisma/client";

/**
 * Registra uma edição MANUAL (humana) feita direto no Google Doc, detectada pelo
 * webhook do Drive quando o ping NÃO é eco de uma edição programática (ver
 * lib/google/doc-edit-marker). Cria/atualiza um ContractChangeLog
 * `action:"human_doc_edit"`, `source:"user"` — que sobrevive à retention (não é
 * NOISE_ACTION) e aparece ATRIBUÍDO no painel Mudanças.
 *
 * DE PROPÓSITO SEM DIFF: capturar o conteúdo do Doc no webhook pra diffar provou
 * ser frágil (o eco da IA se dobra no diff humano; formatos inconsistentes entre
 * writers; export por ping). O valor aqui é a ATRIBUIÇÃO ("um humano editou o Doc
 * direto, às X") — o conteúdo em si está no próprio Doc. A IA já loga o que ELA
 * mudou (source:"ai" com diff).
 *
 * Coalesce: pings de uma sessão de edição humana (dentro de COALESCE_MS) viram
 * UMA entry (só empurra o createdAt). Sem identidade — o Doc é compartilhado e o
 * webhook não traz o editor.
 */

type Db = {
  contractChangeLog: Pick<
    Prisma.ContractChangeLogDelegate,
    "findFirst" | "create" | "update"
  >;
};

export const HUMAN_DOC_EDIT_ACTION = "human_doc_edit";
const COALESCE_MS = 3 * 60 * 1000;

export interface RecordHumanDocEditDeps {
  db: Db;
  now: () => Date;
}

export interface RecordHumanDocEditResult {
  outcome: "created" | "coalesced";
  changeLogId: string;
}

export async function recordHumanDocEdit(
  deps: RecordHumanDocEditDeps,
  params: { contractId: string; details?: Record<string, unknown> }
): Promise<RecordHumanDocEditResult> {
  const now = deps.now();

  // Entry recente do mesmo burst humano? → coalesce (só empurra createdAt).
  const recent = (await deps.db.contractChangeLog.findFirst({
    where: {
      contractId: params.contractId,
      action: HUMAN_DOC_EDIT_ACTION,
      createdAt: { gt: new Date(now.getTime() - COALESCE_MS) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  })) as { id: string } | null;

  if (recent) {
    await deps.db.contractChangeLog.update({
      where: { id: recent.id },
      data: { createdAt: now },
    });
    return { outcome: "coalesced", changeLogId: recent.id };
  }

  const created = await deps.db.contractChangeLog.create({
    data: {
      contractId: params.contractId,
      action: HUMAN_DOC_EDIT_ACTION,
      summary: "Edição manual detectada no documento",
      source: "user",
      details: { manual: true, ...(params.details ?? {}) },
    },
    select: { id: true },
  });
  return { outcome: "created", changeLogId: created.id };
}
