import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, type AuthContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";

/**
 * PATCH/DELETE de uma opção do catálogo de garantias.
 *
 * DESATIVAR é o caminho recomendado (e o que a UI oferece primeiro): o
 * `provider` já está gravado no `dataJson` de formulários e contratos, e é por
 * ele que a cláusula da seguradora é selecionada. Excluir não corrompe nada do
 * que já foi gerado — só some do select — mas some sem deixar rastro do que a
 * imobiliária um dia ofereceu.
 */

const patchSchema = z.object({
  provider: z.string().max(120).optional(),
  label: z.string().max(120).nullable().optional(),
  active: z.boolean().optional(),
  position: z.number().int().min(0).max(999).optional(),
});

type GuardResult =
  | { error: NextResponse; ctx: null }
  | { error: null; ctx: AuthContext };

async function guard(req: NextRequest): Promise<GuardResult> {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return { error: authResult.response, ctx: null };
  const { ctx } = authResult;
  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.ORG_SETTINGS_EDIT,
    });
  } catch (err) {
    if (
      err instanceof PermissionDeniedError ||
      err instanceof MembershipRequiredError
    ) {
      return {
        error: NextResponse.json({ error: err.code }, { status: err.status }),
        ctx: null,
      };
    }
    throw err;
  }
  return { error: null, ctx };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const g = await guard(req);
  if (g.error) return g.error;
  const ctx = g.ctx;

  // Cross-org guard: id sozinho não prova posse.
  const existing = await prisma.garantiaOption.findFirst({
    where: { id: params.id, orgId: ctx.orgId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Opção não encontrada" }, { status: 404 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const updated = await prisma.garantiaOption.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.provider !== undefined
        ? { provider: parsed.data.provider.trim() }
        : {}),
      ...(parsed.data.label !== undefined
        ? { label: parsed.data.label?.trim() || null }
        : {}),
      ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
      ...(parsed.data.position !== undefined
        ? { position: parsed.data.position }
        : {}),
    },
  });

  audit(
    {
      orgId: ctx.orgId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    {
      action: "GARANTIA_OPTION_UPDATED",
      result: "SUCCESS",
      resourceType: "GarantiaOption",
      resource: updated.id,
      metadata: { tipo: updated.tipo, changed: Object.keys(parsed.data) },
    },
  );

  return NextResponse.json({
    option: {
      id: updated.id,
      tipo: updated.tipo,
      provider: updated.provider,
      label: updated.label,
      active: updated.active,
      position: updated.position,
    },
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const g = await guard(req);
  if (g.error) return g.error;
  const ctx = g.ctx;

  const existing = await prisma.garantiaOption.findFirst({
    where: { id: params.id, orgId: ctx.orgId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Opção não encontrada" }, { status: 404 });
  }

  await prisma.garantiaOption.delete({ where: { id: existing.id } });

  audit(
    {
      orgId: ctx.orgId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    {
      action: "GARANTIA_OPTION_DELETED",
      result: "SUCCESS",
      resourceType: "GarantiaOption",
      resource: existing.id,
      metadata: { tipo: existing.tipo, provider: existing.provider },
    },
  );

  return NextResponse.json({ ok: true });
}
