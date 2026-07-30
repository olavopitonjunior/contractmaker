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
 * UMA entry (só empurra o createdAt).
 *
 * ATRIBUIÇÃO best-effort: o webhook não traz o editor, mas o app sabe quem está
 * com o iframe do editor aberto (marcador de presença em Redis alimentado pelo
 * ping do editor — ver lib/contracts/editor-presence). Quando o marcador resolve
 * UM usuário, a entry nasce com `userId` + `details.attribution: "editor_ping"`
 * (heurística DECLARADA, não prova de autoria). Sem marcador, segue sem userId — e
 * a UI rotula "Manual (autor não identificado)", nunca "Sistema".
 */

type Db = {
  contractChangeLog: Pick<
    Prisma.ContractChangeLogDelegate,
    "findFirst" | "create" | "update"
  >;
};

export const HUMAN_DOC_EDIT_ACTION = "human_doc_edit";
/** Marca em `details` que o userId veio da heurística de presença, não do Drive. */
export const EDITOR_PING_ATTRIBUTION = "editor_ping";
const COALESCE_MS = 3 * 60 * 1000;

export interface RecordHumanDocEditDeps {
  db: Db;
  now: () => Date;
  /**
   * Best-effort: userId de quem estava com o editor aberto. Ausente/`null` →
   * entry sem atribuição. Nunca deve lançar (erros são engolidos aqui).
   */
  resolveEditorUserId?: (contractId: string) => Promise<string | null>;
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
    select: { id: true, userId: true },
  })) as { id: string; userId: string | null } | null;

  // Burst já atribuído: nada a resolver (poupa o roundtrip no Redis) e nada a
  // trocar — mudar a autoria no meio de um coalesce seria pior que a falta dela.
  if (recent?.userId) {
    await deps.db.contractChangeLog.update({
      where: { id: recent.id },
      data: { createdAt: now },
    });
    return { outcome: "coalesced", changeLogId: recent.id };
  }

  let editorUserId: string | null = null;
  if (deps.resolveEditorUserId) {
    try {
      editorUserId = await deps.resolveEditorUserId(params.contractId);
    } catch {
      editorUserId = null; // atribuição é acessório: nunca derruba o registro.
    }
  }

  const details: Record<string, unknown> = {
    manual: true,
    ...(params.details ?? {}),
    ...(editorUserId ? { attribution: EDITOR_PING_ATTRIBUTION } : {}),
  };

  if (recent) {
    // Entry órfã: ENRIQUECE (null → userId) se o marcador resolveu alguém.
    const data: Prisma.ContractChangeLogUncheckedUpdateInput = { createdAt: now };
    if (editorUserId) {
      data.userId = editorUserId;
      data.details = details as Prisma.InputJsonObject;
    }
    await deps.db.contractChangeLog.update({
      where: { id: recent.id },
      data,
    });
    return { outcome: "coalesced", changeLogId: recent.id };
  }

  const created = await deps.db.contractChangeLog.create({
    data: {
      contractId: params.contractId,
      action: HUMAN_DOC_EDIT_ACTION,
      summary: "Edição manual detectada no documento",
      source: "user",
      userId: editorUserId,
      details: details as Prisma.InputJsonObject,
    },
    select: { id: true },
  });
  return { outcome: "created", changeLogId: created.id };
}
