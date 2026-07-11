import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import {
  requirePlatformRole,
  PlatformRoleRequiredError,
} from "@/lib/security/rbac/platform";
import { subdomainSchema } from "@/lib/tenant/subdomain";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { MODULE, MODULE_CATALOG, isValidModule, type ModuleKey } from "@/lib/modules/catalog";
import { seedPipeline } from "@/lib/pipelines/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createOrgSchema = z.object({
  name: z.string().trim().min(2).max(120),
  subdomain: subdomainSchema,
  ownerEmail: z.string().email().toLowerCase().trim(),
  ownerName: z.string().trim().min(2).max(120).optional(),
  // Módulos habilitados na criação. Default: ambos. Strings inválidas ignoradas.
  modules: z.array(z.string()).optional(),
  // Dados cadastrais da imobiliária — usados na cláusula da administradora dos
  // contratos de locação (contract-generation lê creci/legalName/legalAddress).
  legalName: z.string().trim().max(200).optional(),
  cnpj: z.string().trim().max(20).optional(),
  creci: z.string().trim().max(40).optional(),
  legalAddress: z.string().trim().max(300).optional(),
});

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

/** GET /api/admin/orgs — lista tenants + KPIs. Gated (support+). */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await gate(session.user.id, "support");
  if (denied) return denied;

  const orgs = await prisma.organization.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      slug: true,
      subdomain: true,
      createdAt: true,
      _count: { select: { members: true, pipelines: true, asaasAccounts: true } },
    },
  });

  return NextResponse.json({
    orgs: orgs.map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      subdomain: o.subdomain,
      createdAt: o.createdAt,
      members: o._count.members,
      pipelines: o._count.pipelines,
      asaasAccounts: o._count.asaasAccounts,
    })),
  });
}

/** POST /api/admin/orgs — cria tenant (admin-led). Gated (super_admin). */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await gate(session.user.id, "super_admin");
  if (denied) return denied;

  const parsed = createOrgSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validação falhou", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { name, subdomain, ownerEmail, ownerName, legalName, cnpj, creci, legalAddress } =
    parsed.data;

  // Módulos a habilitar: filtra inválidos; default = ambos quando não informado.
  const requestedModules = (parsed.data.modules ?? [MODULE.VENDAS, MODULE.LOCACAO]).filter(
    isValidModule
  ) as ModuleKey[];
  const enabledModules =
    requestedModules.length > 0 ? Array.from(new Set(requestedModules)) : [MODULE.VENDAS];
  const locacaoEnabled = enabledModules.includes(MODULE.LOCACAO);
  const vendasEnabled = enabledModules.includes(MODULE.VENDAS);

  // Unicidade de subdomínio (a constraint @unique também protege, mas damos 409 claro).
  const subTaken = await prisma.organization.findUnique({ where: { subdomain } });
  if (subTaken) {
    return NextResponse.json(
      { error: "SUBDOMAIN_TAKEN", message: `Subdomínio "${subdomain}" já está em uso` },
      { status: 409 }
    );
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: ownerEmail },
    select: { id: true },
  });
  // Senha temporária só pra owner novo (entregue por canal seguro — Resend pode estar sandbox).
  const tempPassword = existingUser ? null : `${randomBytes(9).toString("base64url")}!7`;
  const slug = subdomain; // subdomínio é único e url-safe → serve de slug

  const result = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name,
        slug,
        subdomain,
        legalName: legalName ?? undefined,
        cnpj: cnpj ?? undefined,
        creci: creci ?? undefined,
        legalAddress: legalAddress ?? undefined,
      },
    });

    const ownerId =
      existingUser?.id ??
      (
        await tx.user.create({
          data: {
            email: ownerEmail,
            name: ownerName ?? null,
            passwordHash: await bcrypt.hash(tempPassword!, 10),
            emailVerified: new Date(),
          },
          select: { id: true },
        })
      ).id;

    await tx.orgMembership.create({
      data: { userId: ownerId, orgId: org.id, role: "owner" },
    });

    // Pipelines dos módulos habilitados (stages canônicos via helper idempotente).
    // Um tenant só-locação não carrega um funil de vendas órfão, e vice-versa.
    if (vendasEnabled) await seedPipeline(org.id, "venda", tx);
    if (locacaoEnabled) await seedPipeline(org.id, "locacao", tx);

    // Entitlements de módulos — grava uma row EXPLÍCITA por módulo do catálogo,
    // com `enabled` refletindo a intenção. Sem isto, um módulo ausente resolveria
    // para `enabled=true` (fail-open em lib/modules/read.ts) e um tenant
    // só-locação continuaria com Vendas ligado. Determinístico > fail-open.
    await tx.orgModule.createMany({
      data: MODULE_CATALOG.map((m) => ({
        orgId: org.id,
        module: m.key,
        enabled: enabledModules.includes(m.key),
      })),
    });

    await tx.brandingSettings.create({ data: { orgId: org.id } });

    return { org, ownerId };
  });

  await audit(
    extractAuditContextFromRequest(req, result.org.id, session.user.id),
    {
      action: "ORG_CREATED",
      result: "SUCCESS",
      resourceType: "Organization",
      resource: result.org.id,
      metadata: { name, subdomain, ownerEmail, ownerCreated: !existingUser, modules: enabledModules },
    }
  );

  return NextResponse.json(
    {
      ok: true,
      org: { id: result.org.id, name, slug, subdomain, modules: enabledModules },
      owner: { email: ownerEmail, userId: result.ownerId, tempPassword },
    },
    { status: 201 }
  );
}
