import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import {
  requirePlatformRole,
  PlatformRoleRequiredError,
} from "@/lib/security/rbac/platform";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { getOrgModules } from "@/lib/modules/read";
import {
  MODULE,
  MODULE_CATALOG,
  isValidModule,
  isValidFeature,
  featureModule,
  type FeatureKey,
} from "@/lib/modules/catalog";
import { seedPipeline } from "@/lib/pipelines/seed";
import { seedCanonicalTemplatesForOrg } from "@/lib/templates/canonical-seed";
import { canonicalModalidadesForModules } from "@/lib/templates/canonical-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function gate(userId: string, role: "support" | "super_admin") {
  try {
    await requirePlatformRole(userId, role);
    return null;
  } catch (err) {
    if (err instanceof PlatformRoleRequiredError) {
      return NextResponse.json(
        { error: err.code, requiredRole: err.requiredRole },
        { status: err.status }
      );
    }
    throw err;
  }
}

/** GET — catálogo + estado atual de módulos da org. Gated (support+). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { orgId: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await gate(session.user.id, "support");
  if (denied) return denied;

  const org = await prisma.organization.findUnique({
    where: { id: params.orgId },
    select: { id: true },
  });
  if (!org) {
    return NextResponse.json({ error: "Org não encontrada" }, { status: 404 });
  }

  const current = await getOrgModules(params.orgId);
  return NextResponse.json({ catalog: MODULE_CATALOG, current });
}

const patchSchema = z.object({
  module: z.string(),
  enabled: z.boolean().optional(),
  // Overrides de sub-funções: { "locacao.cobrancas": true, ... }
  featureFlags: z.record(z.boolean()).optional(),
});

/** PATCH — liga/desliga módulo e sub-funções da org. Gated (super_admin). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { orgId: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await gate(session.user.id, "super_admin");
  if (denied) return denied;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validação falhou", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { module, enabled, featureFlags } = parsed.data;

  if (!isValidModule(module)) {
    return NextResponse.json(
      { error: "INVALID_MODULE", message: `Módulo "${module}" desconhecido` },
      { status: 400 }
    );
  }

  const org = await prisma.organization.findUnique({
    where: { id: params.orgId },
    select: { id: true },
  });
  if (!org) {
    return NextResponse.json({ error: "Org não encontrada" }, { status: 404 });
  }

  // Sanitiza featureFlags: só chaves de feature válidas E pertencentes a este módulo.
  let sanitizedFlags: Record<string, boolean> | undefined;
  if (featureFlags) {
    sanitizedFlags = {};
    for (const [k, v] of Object.entries(featureFlags)) {
      if (isValidFeature(k) && featureModule(k as FeatureKey) === module) {
        sanitizedFlags[k] = v;
      }
    }
  }

  const existing = await prisma.orgModule.findUnique({
    where: { orgId_module: { orgId: params.orgId, module } },
    select: { enabled: true, featureFlags: true },
  });

  // Merge de overrides (não substitui o conjunto inteiro — patch incremental).
  const mergedFlags = {
    ...((existing?.featureFlags as Record<string, boolean> | null) ?? {}),
    ...(sanitizedFlags ?? {}),
  };

  await prisma.orgModule.upsert({
    where: { orgId_module: { orgId: params.orgId, module } },
    create: {
      orgId: params.orgId,
      module,
      enabled: enabled ?? true,
      featureFlags: mergedFlags,
    },
    update: {
      ...(typeof enabled === "boolean" ? { enabled } : {}),
      featureFlags: mergedFlags,
    },
  });

  // Habilitar um módulo cria o pipeline correspondente se ainda não existir —
  // fecha o gap "ligar módulo não cria pipeline" (o seed só rodava na criação da
  // org). Idempotente: no-op quando o pipeline do kind já existe.
  if (enabled === true) {
    await seedPipeline(params.orgId, module === MODULE.LOCACAO ? "locacao" : "venda");
    // ...e os templates canônicos DAQUELE módulo. A criação do tenant só semeia
    // os módulos escolhidos ali; sem isto, ligar Vendas depois deixava a org sem
    // nenhum template de venda e a 1ª geração morria em "Nenhum template ativo".
    // Idempotente por natureza (pula modalidade que a org já tem). Best-effort:
    // o módulo já foi habilitado e o backfill segue em `sync-templates --seed`.
    try {
      await seedCanonicalTemplatesForOrg(params.orgId, {
        onlyModalidades: canonicalModalidadesForModules([module]),
      });
    } catch (err) {
      console.error("[admin/orgs/modules] seed de templates falhou:", err);
    }
  }

  await audit(extractAuditContextFromRequest(req, params.orgId, session.user.id), {
    action: "ORG_MODULES_UPDATED",
    result: "SUCCESS",
    resourceType: "Organization",
    resource: params.orgId,
    metadata: { module, enabled, featureFlags: sanitizedFlags },
  });

  const current = await getOrgModules(params.orgId);
  return NextResponse.json({ ok: true, current });
}
