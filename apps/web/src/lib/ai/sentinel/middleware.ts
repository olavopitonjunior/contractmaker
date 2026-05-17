/**
 * Middleware Sentinel — avalia cada proposta de tool_use vinda do Editor/
 * Curator contra `policy.yaml` ANTES da execução. Em rejeição:
 *
 *   - Retorna `{ decision: "reject", ruleId, reason }` pro chamador.
 *   - Grava AuditLog `AGENT_TOOL_BLOCKED` com payload {ruleId, tool, input}.
 *   - Chamador (Editor/Curator runner) marca tool_call.success = false e
 *     emite tool_result com summary explicando o bloqueio.
 *
 * Pra `extractedText` de anexos, usa `quarantineAttachment` que:
 *   - Roda `classifyText` pra obter trustedScore + intent.
 *   - Se trustedScore < 0.5 OR intent === "injection": quarantina o anexo
 *     (não vira parte de `state.attachmentBlock`).
 *   - Grava AuditLog `SENTINEL_ATTACHMENT_QUARANTINED`.
 */

import { prisma } from "@/lib/db/prisma";
import { getBudgetCap, getContractTokensSpent } from "../budget";
import { findMatchingRule, type PolicyContext } from "./policy-engine";
import { classifyText, type ClassificationResult } from "./classifier";
import type { OrchestratorState } from "../orchestrator/state";

export type PolicyDecision =
  | { decision: "approve" }
  | { decision: "reject"; ruleId: string; reason: string };

export interface ToolCallProposal {
  tool: string;
  input: Record<string, unknown>;
}

export interface ApplyPolicyOptions {
  /** Quando true, grava AuditLog se rejeitar. Default true. */
  audit?: boolean;
}

/**
 * Avalia uma proposta de tool_use contra a policy.
 * Retorna {decision: "approve"} ou {decision: "reject", ruleId, reason}.
 */
export async function applyPolicy(
  proposal: ToolCallProposal,
  state: OrchestratorState,
  options: ApplyPolicyOptions = {}
): Promise<PolicyDecision> {
  // Carrega budget só se a policy precisar — overhead 1 query/turn.
  let tokensSpent: number | undefined;
  let budgetCap: number | undefined;
  try {
    budgetCap = getBudgetCap();
    tokensSpent = await getContractTokensSpent(state.contractId);
  } catch {
    // Sem budget info? Default permissive — fail-open em metadata,
    // fail-closed só em regras explícitas.
  }

  const ctx: PolicyContext = {
    tool: proposal.tool,
    input: proposal.input,
    contractId: state.contractId,
    orgId: state.orgId,
    userId: state.userId,
    mode: state.mode,
    tokensSpent,
    budgetCap,
  };

  const matched = findMatchingRule(ctx);
  if (!matched) return { decision: "approve" };

  if (matched.action === "warn") {
    console.warn(`[sentinel] regra ${matched.id} disparou WARN: ${matched.reason}`);
    return { decision: "approve" };
  }

  // reject ou reject_and_alert
  if (options.audit !== false) {
    void prisma.auditLog
      .create({
        data: {
          orgId: state.orgId,
          userId: state.userId,
          action: "AGENT_TOOL_BLOCKED",
          resourceType: "contract",
          resource: state.contractId,
          result: "DENIED",
          metadata: {
            ruleId: matched.id,
            tool: proposal.tool,
            input: proposal.input,
            reason: matched.reason,
            severity: matched.action,
          } as object,
        },
      })
      .catch((err) => {
        console.error("[sentinel] audit log falhou:", err);
      });
  }

  return { decision: "reject", ruleId: matched.id, reason: matched.reason };
}

export interface QuarantineDecision {
  /** Se true, o anexo passou — pode virar attachmentBlock. */
  passed: boolean;
  classification: ClassificationResult;
  /** Mensagem pra logar/exibir quando quarantineado. */
  reason?: string;
}

/**
 * Avalia extractedText de um anexo antes de virar parte do contexto.
 * Se classificação indica injection/exfiltration ou trustedScore < 0.5,
 * quarantina o anexo (passed: false) e grava audit.
 */
export async function quarantineAttachment(
  text: string,
  state: Pick<OrchestratorState, "contractId" | "orgId" | "userId">,
  options: { audit?: boolean; fastPathOnly?: boolean } = {}
): Promise<QuarantineDecision> {
  const classification = await classifyText(text, {
    orgId: state.orgId,
    contractId: state.contractId,
    fastPathOnly: options.fastPathOnly,
  });

  const dangerous =
    classification.intent === "injection" ||
    classification.intent === "exfiltration" ||
    classification.trustedScore < 0.5;

  if (!dangerous) {
    return { passed: true, classification };
  }

  if (options.audit !== false) {
    void prisma.auditLog
      .create({
        data: {
          orgId: state.orgId,
          userId: state.userId,
          action: "SENTINEL_ATTACHMENT_QUARANTINED",
          resourceType: "contract",
          resource: state.contractId,
          result: "DENIED",
          metadata: {
            intent: classification.intent,
            trustedScore: classification.trustedScore,
            reason: classification.reason,
            fastPath: classification.fastPath,
            textPreview: text.slice(0, 200),
          } as object,
        },
      })
      .catch((err) => {
        console.error("[sentinel] audit attachment falhou:", err);
      });
  }

  return {
    passed: false,
    classification,
    reason: `Anexo quarantinado: ${classification.reason ?? classification.intent}`,
  };
}
