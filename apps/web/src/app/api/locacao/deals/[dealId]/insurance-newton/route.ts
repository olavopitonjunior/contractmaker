import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PERMISSION, type PermissionKey } from "@/lib/security/rbac/permissions";
import { can } from "@/lib/security/rbac/check";
import {
  ensureLocacaoApiAccess,
  isRouteError,
} from "@/lib/locacao/route-helpers";
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
 * Auth: Bearer scope `locacao:rw` (POST) / `locacao:r` (GET) via
 * ensureLocacaoApiAccess — RBAC por ramo (INSURANCE_MANAGE / GUARANTEE_MANAGE /
 * CLIENT_UPDATE) + entitlement do módulo locação. Migrado de `documents:rw`
 * (2026-07-24, antes do esquema locacao:*; nada consumia em prod). O `dealId`
 * do path é contexto/auditoria; o vínculo real é via `leaseContractId`
 * (validado contra a org).
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

const PERM_BY_RAMO: Record<"incendio" | "fianca" | "credito", PermissionKey> = {
  incendio: PERMISSION.INSURANCE_MANAGE,
  fianca: PERMISSION.GUARANTEE_MANAGE,
  credito: PERMISSION.CLIENT_UPDATE,
};

// Pré-auth só extrai o `ramo` (necessário pro RBAC por ramo) com erro GENÉRICO —
// a validação completa (422 com .flatten()) só roda depois de autenticado, senão
// a rota vira oráculo de schema pra caller anônimo.
const ramoSchema = z.object({ ramo: z.enum(["incendio", "fianca", "credito"]) });

export async function POST(req: NextRequest, { params }: { params: { dealId: string } }) {
  const raw = await req.json().catch(() => null);
  const ramoParsed = ramoSchema.safeParse(raw);
  if (!ramoParsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const ctx = await ensureLocacaoApiAccess(req, PERM_BY_RAMO[ramoParsed.data.ramo], {
    scope: "locacao:rw",
  });
  if (isRouteError(ctx)) return ctx;

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
  }
  const data = parsed.data;

  const result =
    data.ramo === "incendio"
      ? await recordIncendioQuote(ctx.orgId, data)
      : data.ramo === "fianca"
        ? await recordFiancaGuarantee(ctx.orgId, data)
        : await recordCreditAnalysis(ctx.orgId, data);

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const AUDIT = {
    incendio: { action: "INSURANCE_CREATE", resourceType: "InsurancePolicy" },
    fianca: { action: "GUARANTEE_CREATE", resourceType: "Guarantee" },
    credito: { action: "CREDIT_ANALYSIS_DECIDED", resourceType: "CreditAnalysis" },
  } as const;
  // ctx.userId/orgId — id efetivo do helper (respeita impersonation em session),
  // não o actor cru do requireApiAuth.
  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
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
  const ctx = await ensureLocacaoApiAccess(req, PERMISSION.INSURANCE_VIEW, {
    scope: "locacao:r",
  });
  if (isRouteError(ctx)) return ctx;

  const leaseContractId = new URL(req.url).searchParams.get("leaseContractId");
  if (!leaseContractId) {
    return NextResponse.json({ error: "leaseContractId obrigatório" }, { status: 400 });
  }
  const result = await readDealInsurance(ctx.orgId, leaseContractId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  // Payload junta policies + guarantee; o gate da rota é INSURANCE_VIEW, então:
  // sem GUARANTEE_VIEW a garantia sai inteira do payload, e mesmo com ela os
  // campos sensíveis (dadosJson bancário, fiadorPartyJson, historicoJson) não
  // atravessam a superfície M2M — mesma regra do GET /api/locacao/leases/[id].
  const payload = result.data as Record<string, unknown>;
  const guarantee = payload.guarantee as Record<string, unknown> | null | undefined;
  const canSeeGuarantee =
    ctx.permissions && can(ctx.permissions, PERMISSION.GUARANTEE_VIEW);
  return NextResponse.json({
    ...payload,
    guarantee:
      guarantee && canSeeGuarantee
        ? (() => {
            const {
              dadosJson: _d,
              fiadorPartyJson: _f,
              historicoJson: _h,
              ...safe
            } = guarantee;
            return safe;
          })()
        : null,
  });
}
