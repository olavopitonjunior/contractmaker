import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { audit } from "@/lib/security/audit";
import {
  recordIncendioQuote,
  recordFiancaGuarantee,
  recordCreditAnalysis,
  readDealInsurance,
} from "@/lib/locacao/insurance-service";

export const runtime = "nodejs";

/**
 * `-newton` (Bearer) twin da gestão de seguros pro agente Max gravar/ler resultado.
 *
 * POST — registra cotação de incêndio (InsurancePolicy) OU a fiança consolidada
 *   (Guarantee = fonte-da-verdade). Body discrimina por `ramo`.
 * GET  — lê apólices + garantia de um contrato (?leaseContractId=...).
 *
 * Auth: Bearer scope `documents:rw` (mesmo trilho de attachments-newton). O `dealId`
 * do path é contexto/auditoria; o vínculo real é via `leaseContractId` (validado contra a org).
 */

const incendioSchema = z.object({
  ramo: z.literal("incendio"),
  leaseContractId: z.string().min(1),
  seguradora: z.string().min(2),
  status: z.string().optional(),
  apoliceNumero: z.string().optional(),
  premioMensal: z.number().nonnegative().optional(),
  vigenciaInicio: z.string().optional(),
  vigenciaFim: z.string().optional(),
  prazoMeses: z.number().int().positive().optional(),
  responsavelPagamento: z.enum(["imobiliaria", "locatario", "proprietario"]).optional(),
  coberturaJson: z.any().optional(),
  externalRef: z.string().optional(),
});

const fiancaSchema = z.object({
  ramo: z.literal("fianca"),
  leaseContractId: z.string().min(1),
  provider: z.string().optional(),
  status: z.string().optional(),
  premioMensal: z.number().nonnegative().optional(),
  coberturaMeses: z.number().int().positive().optional(),
  consolidado: z.any().optional(),
  custoJson: z.any().optional(),
  externalRef: z.string().optional(),
});

const creditoSchema = z.object({
  ramo: z.literal("credito"),
  tenantId: z.string().min(1),
  leaseDealId: z.string().optional(),
  status: z.string(),
  decisionJson: z.any().optional(),
  scoreInterno: z.number().int().optional(),
  externalRef: z.string().optional(),
});

const bodySchema = z.discriminatedUnion("ramo", [incendioSchema, fiancaSchema, creditoSchema]);

export async function POST(req: NextRequest, { params }: { params: { dealId: string } }) {
  const auth = await requireApiAuth(req, { scope: "documents:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
  }
  const data = parsed.data;

  const result =
    data.ramo === "incendio"
      ? await recordIncendioQuote(auth.org.id, data)
      : data.ramo === "fianca"
        ? await recordFiancaGuarantee(auth.org.id, data)
        : await recordCreditAnalysis(auth.org.id, data);

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const AUDIT = {
    incendio: { action: "INSURANCE_CREATE", resourceType: "InsurancePolicy" },
    fianca: { action: "GUARANTEE_CREATE", resourceType: "Guarantee" },
    credito: { action: "CREDIT_ANALYSIS_DECIDED", resourceType: "CreditAnalysis" },
  } as const;
  await audit(
    { orgId: auth.org.id, userId: auth.actor.effectiveUserId },
    {
      action: AUDIT[data.ramo].action,
      result: "SUCCESS",
      resourceType: AUDIT[data.ramo].resourceType,
      metadata: { via: "newton", ramo: data.ramo, dealId: params.dealId },
    }
  );

  return NextResponse.json(result.data, { status: 201 });
}

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, { scope: "documents:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const leaseContractId = new URL(req.url).searchParams.get("leaseContractId");
  if (!leaseContractId) {
    return NextResponse.json({ error: "leaseContractId obrigatório" }, { status: 400 });
  }
  const result = await readDealInsurance(auth.org.id, leaseContractId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}
