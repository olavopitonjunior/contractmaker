import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { requireApproval, approvalResponse } from "@/lib/api/intents";
import { guardContractScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";

/**
 * POST /api/contracts/[id]/intents/update-field
 *
 * Cria ActionIntent pra atualizar UM campo do contrato (HITL via Bearer).
 * Após aprovação humana via `/intents/<id>`, o executor aplica `lodash.set`
 * no `Contract.dataJson` + incrementa `Contract.version`.
 *
 * Auth: Bearer (scope `contracts:rw`) ou session. Cross-user guard via
 * `contract.userId`.
 *
 * Restrições:
 * - Contrato `status === "aprovado"` bloqueia (return 409). Reabra primeiro.
 * - `fieldPath` precisa estar na whitelist abaixo. Tudo fora é 400.
 * - `value` aceita string | number | null (PII e valores monetários cobertos).
 *
 * Body:
 *   { fieldPath: string, value: string | number | null }
 *
 * Header:
 *   X-Idempotency-Key: <uuid v4>   (recomendado, evita intent duplicada)
 */

// Whitelist de fieldPaths editáveis. Ampliação requer mudança de schema + bench
// do executor (validar que cada path realmente aceita o valor passado).
// IMPORTANTE: NUNCA inclua `userId`, `orgId`, `status`, `version`, `templateId`,
// `googleDocId` — esses identificam ownership/state e mudar via tool é vetor de
// privilege escalation.
const ALLOWED_FIELD_PATHS = new Set([
  // Counterparty / partes
  "vendedores[0].nome",
  "vendedores[0].cpf",
  "vendedores[0].rg",
  "vendedores[0].endereco",
  "compradores[0].nome",
  "compradores[0].cpf",
  "compradores[0].rg",
  "compradores[0].endereco",
  // Pagamento
  "pagamento.valor_total",
  "pagamento.forma",
  "pagamento.prazo",
  // Vigência
  "vigencia.data_inicio",
  "vigencia.data_fim",
  // Imóvel
  "imovel.endereco",
  "imovel.matricula",
]);

const bodySchema = z.object({
  fieldPath: z
    .string()
    .min(1)
    .refine((p) => ALLOWED_FIELD_PATHS.has(p), {
      message:
        "fieldPath fora da whitelist. Veja a lista em /api/contracts/[id]/intents/update-field/route.ts.",
    }),
  value: z.union([z.string(), z.number(), z.null()]),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const apiAuth = await requireApiAuth(req, { scope: "contracts:rw" });
  if (isAuthFailure(apiAuth)) return authFailureResponse(apiAuth);

  const rawBody = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Bad Request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { fieldPath, value } = parsed.data;

  // Cross-org + cross-user check (carrega antes do requireApproval pra
  // 403 não virar intent pending falso-positivo). O org-check vale pra
  // session E bearer — 404 pra não vazar existência.
  const contract = await prisma.contract.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      userId: true,
      status: true,
      version: true,
      deal: { select: { pipeline: { select: { orgId: true } } } },
    },
  });
  if (!contract || contract.deal.pipeline.orgId !== apiAuth.org.id) {
    return NextResponse.json(
      { error: "Contrato não encontrado" },
      { status: 404 }
    );
  }
  // Escopo do gerente + CONTRACT_EDIT.
  const denied = await guardContractScope({
    contractId: params.id,
    userId: apiAuth.actor.effectiveUserId,
    orgId: apiAuth.org.id,
    via: apiAuth.ident.via,
    permission: PERMISSION.CONTRACT_EDIT,
  });
  if (denied) return denied;

  if (
    apiAuth.ident.via === "bearer" &&
    contract.userId !== apiAuth.ident.userId
  ) {
    return NextResponse.json(
      { error: "Forbidden", reason: "not the contract owner" },
      { status: 403 }
    );
  }
  if (contract.status === "aprovado") {
    return NextResponse.json(
      {
        error: "Contract is approved (immutable). Reopen first via /contracts/[id]/reopen",
      },
      { status: 409 }
    );
  }

  const idempotencyKey = req.headers.get("x-idempotency-key");

  const result = await requireApproval<unknown>({
    ctx: apiAuth,
    action: "CONTRACT_FIELD_UPDATE",
    payload: { contractId: params.id, fieldPath, value },
    preview: {
      summary: `Atualizar campo "${fieldPath}" do contrato ${params.id}`,
      details: {
        contractId: params.id,
        fieldPath,
        valuePreview: value === null ? "(null)" : String(value).slice(0, 80),
      },
    },
    req,
    idempotencyKey,
    run: async () => {
      // Session path: executa direto (deep-set + version bump)
      const { runContractFieldUpdate } = await import(
        "@/lib/contracts/update-field-action"
      );
      return runContractFieldUpdate({
        contractId: params.id,
        fieldPath,
        value,
        actorUserId: apiAuth.actor.effectiveUserId,
      });
    },
  });

  return approvalResponse(result);
}
