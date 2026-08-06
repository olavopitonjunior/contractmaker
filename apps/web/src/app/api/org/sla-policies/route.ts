import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { waitUntil } from "@vercel/functions";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import {
  resolveSlaPolicies,
  recomputeSlaDeadlines,
} from "@/lib/pipeline/sla-policies";

/**
 * Política de SLA por stage (plano 2026-08-06, PR 3.5). Espelha o padrão de
 * /api/org/notification-settings: GET pra qualquer membro (a UI mostra o
 * resolvido — linha da org OU default de código), PATCH/DELETE com
 * ORG_SETTINGS_EDIT + Zod strict + audit. Persistimos SÓ divergências: linha
 * em SlaPolicy = personalizado; sem linha = default 5/10. Restaurar padrão =
 * DELETE da linha (não upsert dos valores default — senão o default de código
 * mudar não propagaria).
 *
 * Toda mutação agenda recomputeSlaDeadlines via waitUntil — os deadlines
 * materializados dos deals ativos refletem a política nova sem bloquear a
 * resposta.
 */

const KINDS = ["venda", "locacao"] as const;

function parseKind(req: NextRequest): "venda" | "locacao" | null {
  const kind = new URL(req.url).searchParams.get("kind") ?? "venda";
  return (KINDS as readonly string[]).includes(kind)
    ? (kind as "venda" | "locacao")
    : null;
}

async function requireSettingsEdit(ctx: { userId: string; orgId: string }) {
  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.ORG_SETTINGS_EDIT,
    });
    return null;
  } catch (err) {
    if (
      err instanceof PermissionDeniedError ||
      err instanceof MembershipRequiredError
    ) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }
}

export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const kind = parseKind(req);
  if (!kind) {
    return NextResponse.json({ error: "kind inválido" }, { status: 400 });
  }

  const policies = await resolveSlaPolicies(ctx.orgId, kind);
  return NextResponse.json({ kind, policies });
}

const patchSchema = z
  .object({
    kind: z.enum(KINDS),
    policies: z
      .array(
        z
          .object({
            stageId: z.string().min(1),
            warnDays: z.number().int().min(1).max(365),
            dangerDays: z.number().int().min(1).max(365),
            enabled: z.boolean(),
          })
          .strict()
          .refine((p) => p.dangerDays >= p.warnDays, {
            message: "dangerDays deve ser ≥ warnDays",
            path: ["dangerDays"],
          })
      )
      .min(1)
      .max(30),
  })
  .strict();

export async function PATCH(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const denied = await requireSettingsEdit(ctx);
  if (denied) return denied;

  const raw = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }
  const { kind, policies } = parsed.data;

  // Só stages NÃO-terminais do pipeline da org/kind aceitam política — o
  // resolve é a fonte de quais existem (cross-org guard incluso).
  const resolved = await resolveSlaPolicies(ctx.orgId, kind);
  const editable = new Set(
    resolved.filter((p) => !p.terminal).map((p) => p.stageId)
  );
  const unknown = policies.filter((p) => !editable.has(p.stageId));
  if (unknown.length > 0) {
    return NextResponse.json(
      {
        error: "Stage inválido pra política de SLA",
        stageIds: unknown.map((p) => p.stageId),
      },
      { status: 400 }
    );
  }

  for (const p of policies) {
    await prisma.slaPolicy.upsert({
      where: {
        orgId_scope_key: { orgId: ctx.orgId, scope: "deal_stage", key: p.stageId },
      },
      create: {
        orgId: ctx.orgId,
        scope: "deal_stage",
        key: p.stageId,
        kind,
        warnDays: p.warnDays,
        dangerDays: p.dangerDays,
        enabled: p.enabled,
      },
      update: {
        warnDays: p.warnDays,
        dangerDays: p.dangerDays,
        enabled: p.enabled,
      },
    });
  }

  await audit(
    {
      orgId: ctx.orgId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    {
      action: "ORG_SLA_POLICY_UPDATE",
      result: "SUCCESS",
      resourceType: "sla_policy",
      resource: ctx.orgId,
      metadata: {
        kind,
        policies: policies.map((p) => ({
          stageId: p.stageId,
          warnDays: p.warnDays,
          dangerDays: p.dangerDays,
          enabled: p.enabled,
        })),
      },
    }
  );

  // Re-materializa deadlines fora do request (não bloqueia a resposta).
  waitUntil(recomputeSlaDeadlines(ctx.orgId, kind).catch(() => {}));

  const after = await resolveSlaPolicies(ctx.orgId, kind);
  return NextResponse.json({ kind, policies: after });
}

const deleteSchema = z
  .object({
    kind: z.enum(KINDS),
    /** Ausente = restaura TODOS os stages do kind pro default de código. */
    stageId: z.string().min(1).optional(),
  })
  .strict();

export async function DELETE(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const denied = await requireSettingsEdit(ctx);
  if (denied) return denied;

  const raw = await req.json().catch(() => ({}));
  const parsed = deleteSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }
  const { kind, stageId } = parsed.data;

  const { count } = await prisma.slaPolicy.deleteMany({
    where: {
      orgId: ctx.orgId,
      scope: "deal_stage",
      kind,
      ...(stageId ? { key: stageId } : {}),
    },
  });

  await audit(
    {
      orgId: ctx.orgId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    {
      action: "ORG_SLA_POLICY_RESET",
      result: "SUCCESS",
      resourceType: "sla_policy",
      resource: ctx.orgId,
      metadata: { kind, stageId: stageId ?? "all", removed: count },
    }
  );

  waitUntil(recomputeSlaDeadlines(ctx.orgId, kind).catch(() => {}));

  const after = await resolveSlaPolicies(ctx.orgId, kind);
  return NextResponse.json({ kind, policies: after });
}
