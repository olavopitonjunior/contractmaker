/**
 * Helpers de snapshot HTML pra tools de edição. Reusado pelo agent.ts
 * legacy e pelo EditorAgent do graph multi-agente.
 *
 * Captura `htmlBefore` ANTES da tool de write executar e `htmlAfter`
 * DEPOIS (apenas em sucesso). Em GDocs o snapshot vem de Drive export
 * (getDocPlainText). Falha de Drive não bloqueia execução — segue sem.
 */

import type { AgentContext } from "../types";
import type { ToolOutput } from "./tool-mapping";
import { isEditTool } from "./tool-mapping";

export async function capturePreSnapshot(
  toolName: string,
  context: AgentContext
): Promise<string | undefined> {
  if (!isEditTool(toolName)) return undefined;
  if (!context.googleDocId) return undefined;
  try {
    const { getDocPlainText } = await import("@/lib/google/docs");
    return await getDocPlainText(context.googleDocId);
  } catch {
    return undefined;
  }
}

export async function capturePostSnapshot(
  toolName: string,
  context: AgentContext,
  result: ToolOutput,
  preSnapshot: string | undefined
): Promise<string | undefined> {
  if (preSnapshot === undefined) return undefined;
  if (!context.googleDocId) return undefined;
  if (result.error) return preSnapshot;
  try {
    const { getDocPlainText } = await import("@/lib/google/docs");
    return await getDocPlainText(context.googleDocId);
  } catch {
    return preSnapshot;
  }
}
