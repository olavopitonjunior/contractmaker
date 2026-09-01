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
import { AGING_WARN_DAYS, AGING_DANGER_DAYS } from "@/lib/pipeline/stage-config";

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

  // Persistimos SÓ divergências (contrato no topo do arquivo). A tela manda
  // TODAS as etapas editáveis a cada "Salvar", então gravar o que chega criava
  // linha para etapa que está no padrão — e linha explícita em 5/10 congela a
  // org no default ANTIGO caso o valor de código mude, que é exatamente o que
  // este contrato existe pra impedir. Quem chega igual ao default perde a linha.
  //
  // A regra mora AQUI, e não no cliente, porque é a rota que documenta o
  // contrato e é ela que conhece o default de código — assim vale para qualquer
  // chamador, não só para /settings/sla.
  //
  // `enabled: false` nunca casa (o default resolve `enabled: true`), então
  // etapa DESLIGADA sempre cai no upsert e mantém a linha. Isso é deliberado:
  // o GET mascara os prazos de etapa desligada (devolve `null`, e a tela
  // preenche 5/10), então tratá-la como "igual ao default" apagaria prazos
  // reais que o cliente nem sabe que existem.
  const isCodeDefault = (p: (typeof policies)[number]) =>
    p.enabled &&
    p.warnDays === AGING_WARN_DAYS &&
    p.dangerDays === AGING_DANGER_DAYS;

  for (const p of policies) {
    if (isCodeDefault(p)) {
      await prisma.slaPolicy.deleteMany({
        // `kind` é redundante — `@@unique([orgId, scope, key])` já garante no
        // máximo uma linha, e `stageId` é cuid global, então não há colisão
        // entre esteiras. Vai junto para casar com o `deleteMany` do DELETE
        // logo abaixo: dois filtros diferentes no mesmo arquivo escondem a
        // premissa de unicidade e custam caro na próxima leitura.
        where: { orgId: ctx.orgId, scope: "deal_stage", key: p.stageId, kind },
      });
      continue;
    }
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
        // `effect` distingue quem virou linha de quem PERDEU a linha. Sem ele,
        // um reset ao padrão fica registrado como "warnDays: 5, dangerDays:
        // 10" — indistinguível de uma org que escolheu 5/10 de propósito. Se
        // o default de código mudar depois, quem auditar o log velho conclui
        // errado que havia configuração explícita.
        policies: policies.map((p) => ({
          stageId: p.stageId,
          warnDays: p.warnDays,
          dangerDays: p.dangerDays,
          enabled: p.enabled,
          effect: isCodeDefault(p) ? ("reset" as const) : ("custom" as const),
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
