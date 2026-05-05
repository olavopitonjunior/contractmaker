import { registerIntentExecutor } from "@/lib/api/intents";
import { runContractApproval } from "@/lib/contracts/approve-action";
import { runCreateCommissionCharge } from "@/lib/asaas/charges-action";
import { prisma } from "@/lib/db/prisma";

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

  // CHARGE_CREATE — criar cobrança Asaas após aprovação humana
  registerIntentExecutor("CHARGE_CREATE", async (payload, ctx) => {
    const p = payload as {
      dealId: string;
      billingType: "PIX" | "BOLETO";
      dueDate: string;
      contractId?: string;
      description?: string;
    };
    return runCreateCommissionCharge({
      dealId: p.dealId,
      orgId: ctx.orgId,
      userId: ctx.requestedBy,
      ipAddress: null,
      userAgent: `Newton/intent ${ctx.intentId}`,
      billingType: p.billingType,
      dueDate: p.dueDate,
      contractId: p.contractId,
      description: p.description,
    });
  });

  // DEAL_DELETE_HARD — hard delete via Bearer
  registerIntentExecutor("DEAL_DELETE_HARD", async (payload, ctx) => {
    const p = payload as { dealId: string };
    const deal = await prisma.deal.findUnique({
      where: { id: p.dealId },
      select: {
        id: true,
        formId: true,
        title: true,
        form: { select: { orgId: true } },
        stage: { select: { pipeline: { select: { orgId: true } } } },
      },
    });
    if (!deal) {
      return { status: 404, body: { error: "Deal não encontrado" } };
    }
    const dealOrgId = deal.form?.orgId ?? deal.stage?.pipeline?.orgId;
    if (dealOrgId !== ctx.orgId) {
      return { status: 403, body: { error: "Forbidden" } };
    }
    await prisma.$transaction(async (tx) => {
      await tx.deal.delete({ where: { id: p.dealId } });
      if (deal.formId) {
        await tx.salesForm.delete({ where: { id: deal.formId } }).catch(() => {});
      }
    });
    return {
      status: 200,
      body: { ok: true, mode: "hard", dealId: p.dealId, title: deal.title },
    };
  });

  // ENVELOPE_SEND — enviar contrato pra ClickSign após aprovação humana
  registerIntentExecutor("ENVELOPE_SEND", async (payload) => {
    const p = payload as {
      contractId: string;
      authMethod?: "email" | "whatsapp" | "selfie" | "icp_brasil";
      envelopeName?: string;
      deadlineAt?: string | null;
    };
    const { sendEnvelopeForContract } = await import(
      "@/lib/clicksign/executor"
    );
    try {
      const envelope = await sendEnvelopeForContract({
        contractId: p.contractId,
        authMethod: p.authMethod,
        envelopeName: p.envelopeName,
        deadlineAt: p.deadlineAt ? new Date(p.deadlineAt) : null,
      });
      return { status: 201, body: { envelope } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { status: 500, body: { error: message } };
    }
  });
}
