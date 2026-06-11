import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import { expenseCreateSchema } from "@/lib/locacao/validators";

// Intent-executor: EXPENSE_CREATE_FROM_OCR
// Newton (WhatsApp) chamou OCR (Gemini) numa foto de IPTU/condomínio enviada
// pelo operador. Propôs uma Expense. HITL via ActionIntent: operador confirma
// os campos antes da gravação. Quando aprovado, executor cria a Expense.
//
// docs/locacao/spec.md §11c.

export interface RunCreateExpenseArgs {
  payload: Record<string, unknown>;
  orgId: string;
  userId: string;
}

export interface RunResult<T = unknown> {
  status: number;
  body: T;
}

export async function runCreateExpenseFromIntent(
  args: RunCreateExpenseArgs
): Promise<RunResult> {
  // Valida payload no schema canônico (mesmo do endpoint normal).
  const parsed = expenseCreateSchema.safeParse(args.payload);
  if (!parsed.success) {
    return {
      status: 422,
      body: { error: "OCR payload inválido", details: parsed.error.flatten() },
    };
  }
  const data = parsed.data;

  // Cross-org guard nos FKs (igual ao endpoint normal).
  if (data.leaseContractId) {
    const lc = await prisma.leaseContract.findFirst({
      where: { id: data.leaseContractId, orgId: args.orgId },
      select: { id: true },
    });
    if (!lc) return { status: 422, body: { error: "Contrato não pertence à org." } };
  }
  if (data.propertyId) {
    const p = await prisma.property.findFirst({
      where: { id: data.propertyId, orgId: args.orgId },
      select: { id: true },
    });
    if (!p) return { status: 422, body: { error: "Imóvel não pertence à org." } };
  }

  const expense = await prisma.expense.create({
    data: { ...data, orgId: args.orgId },
  });

  await audit(
    { orgId: args.orgId, userId: args.userId },
    {
      action: "EXPENSE_CREATE",
      result: "SUCCESS",
      resource: expense.id,
      resourceType: "Expense",
      metadata: { type: expense.type, source: "newton_ocr_intent" },
    }
  );

  return { status: 201, body: { expense } };
}
