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
      accountId?: string;
      billingType: "PIX" | "BOLETO";
      dueDate: string;
      contractId?: string;
      description?: string;
    };
    // Se accountId não veio no payload (intents pré-multi-account), resolve
    // pra conta ativa da org. Newton/Bearer tipicamente passa accountId
    // explícito quando UI/admin escolhe.
    let accountId = p.accountId;
    if (!accountId) {
      const org = await prisma.organization.findUnique({
        where: { id: ctx.orgId },
        select: { activeAsaasAccountId: true },
      });
      accountId = org?.activeAsaasAccountId ?? undefined;
      if (!accountId) {
        const fallback = await prisma.asaasAccount.findFirst({
          where: { orgId: ctx.orgId, archivedAt: null, status: "APPROVED" },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        accountId = fallback?.id;
      }
    }
    if (!accountId) {
      return {
        status: 422,
        body: { error: "Nenhuma conta Asaas aprovada disponível na org" },
      };
    }
    return runCreateCommissionCharge({
      dealId: p.dealId,
      orgId: ctx.orgId,
      accountId,
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

  // CERTIDAO_REQUEST — solicitar batch de certidões Infosimples (gasta budget)
  registerIntentExecutor("CERTIDAO_REQUEST", async (payload, ctx) => {
    const p = payload as { dealId: string; batchId: string };
    const { runCertidoesBatchInline } = await import(
      "@/lib/certidoes/newton-runner"
    );
    return runCertidoesBatchInline({
      dealId: p.dealId,
      orgId: ctx.orgId,
      userId: ctx.requestedBy,
      batchId: p.batchId,
    });
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

  // ENVELOPE_CANCEL — cancela envelope ClickSign já enviado (HITL)
  registerIntentExecutor("ENVELOPE_CANCEL", async (payload, ctx) => {
    const p = payload as { envelopeId: string; reason: string };
    const { runEnvelopeCancel } = await import(
      "@/lib/clicksign/cancel-action"
    );
    return runEnvelopeCancel({
      envelopeId: p.envelopeId,
      reason: p.reason,
      actorUserId: ctx.requestedBy,
    });
  });

  // CONTRACT_FIELD_UPDATE — atualiza UM campo de contrato (whitelist enforced
  // no route handler); cria nova version, mantém dataJson atualizado
  registerIntentExecutor("CONTRACT_FIELD_UPDATE", async (payload, ctx) => {
    const p = payload as {
      contractId: string;
      fieldPath: string;
      value: unknown;
    };
    const { runContractFieldUpdate } = await import(
      "@/lib/contracts/update-field-action"
    );
    return runContractFieldUpdate({
      contractId: p.contractId,
      fieldPath: p.fieldPath,
      value: p.value,
      actorUserId: ctx.requestedBy,
    });
  });

  // EXPENSE_CREATE_FROM_OCR — Newton recebeu foto de IPTU/condomínio do operador,
  // rodou Gemini OCR, propôs uma Expense. HITL: operador confirma campos antes
  // da gravação.
  registerIntentExecutor("EXPENSE_CREATE_FROM_OCR", async (payload, ctx) => {
    const { runCreateExpenseFromIntent } = await import(
      "@/lib/locacao/executors/create-expense"
    );
    return runCreateExpenseFromIntent({
      payload: payload as Record<string, unknown>,
      orgId: ctx.orgId,
      userId: ctx.requestedBy,
    });
  });

  // INSPECTION_SCHEDULE — Newton negociou janela com inquilino/vistoriador.
  // HITL quando conflito de agenda foi detectado (executor sinaliza).
  registerIntentExecutor("INSPECTION_SCHEDULE", async (payload, ctx) => {
    const { runScheduleInspectionFromIntent } = await import(
      "@/lib/locacao/executors/schedule-inspection"
    );
    return runScheduleInspectionFromIntent({
      payload: payload as Record<string, unknown>,
      orgId: ctx.orgId,
      userId: ctx.requestedBy,
    });
  });
}
