import { registerIntentExecutor } from "@/lib/api/intents";
import { runContractApproval } from "@/lib/contracts/approve-action";

let registered = false;

/**
 * Registra os executors de ActionIntent. Idempotente: chamada múltiplas vezes
 * é segura (módulo singleton). Importar dentro de `executeIntent` antes de
 * lookup do executor.
 *
 * Para adicionar um novo executor:
 *   1. Registre aqui com `registerIntentExecutor(action, fn)`.
 *   2. A função recebe o payload congelado (igual ao usado no `requireApproval`)
 *      e deve retornar `{ status, body }`.
 *   3. Use lazy imports pra não inflar o bundle das routes que não precisam.
 */
export function ensureIntentExecutorsRegistered(): void {
  if (registered) return;
  registered = true;

  // CONTRACT_APPROVE — aprovação humana de contrato via Bearer
  registerIntentExecutor("CONTRACT_APPROVE", async (payload, ctx) => {
    const p = payload as { contractId: string; force: boolean };
    const result = await runContractApproval({
      contractId: p.contractId,
      force: p.force,
      actorUserId: ctx.requestedBy, // ator semântico é o requester (token owner)
      actorLabel: `Newton (intent ${ctx.intentId} aprovada via session)`,
      enforceOwnerGuard: false,
    });
    return { status: result.status, body: result.body };
  });

  // CHARGE_CREATE, ENVELOPE_SEND, DEAL_DELETE_HARD: TODO próximas iterações
  // (mesmo padrão — extrair runFn pura + registrar aqui).
}
