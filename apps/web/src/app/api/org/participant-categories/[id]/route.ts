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
import {
  categoryAppliesToSchema,
  categoryFieldsSchema,
  terceiroRole,
} from "@/lib/forms/participant-category";

/**
 * PATCH/DELETE de uma categoria de terceiro.
 *
 * O SLUG é imutável: ele já está gravado em `SalesFormParticipant.role` e é o
 * path das respostas em `dataJson.terceiros.<slug>` — renomear órfãnaria o que
 * as pessoas já preencheram. Quem quer outro identificador cria outra categoria
 * e desativa a antiga.
 */

const patchSchema = z.object({
  label: z.string().min(2).max(60).optional(),
  description: z.string().max(300).nullable().optional(),
  appliesTo: categoryAppliesToSchema.optional(),
  fields: categoryFieldsSchema.optional(),
  active: z.boolean().optional(),
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
  const existing = await prisma.formParticipantCategory.findFirst({
    where: { id: params.id, orgId: ctx.orgId },
  });
  if (!existing) {
    return NextResponse.json(
      { error: "Categoria não encontrada" },
      { status: 404 },
    );
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const updated = await prisma.formParticipantCategory.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
      ...(parsed.data.description !== undefined
        ? { description: parsed.data.description || null }
        : {}),
      ...(parsed.data.appliesTo !== undefined
        ? { appliesTo: parsed.data.appliesTo }
        : {}),
      ...(parsed.data.fields !== undefined ? { fields: parsed.data.fields } : {}),
      ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
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
      action: "PARTICIPANT_CATEGORY_UPDATED",
      result: "SUCCESS",
      resourceType: "FormParticipantCategory",
      resource: updated.id,
      metadata: { slug: updated.slug, changed: Object.keys(parsed.data) },
    },
  );

  return NextResponse.json({
    category: {
      id: updated.id,
      slug: updated.slug,
      label: updated.label,
      description: updated.description,
      appliesTo: updated.appliesTo,
      fields: updated.fields,
      active: updated.active,
    },
  });
}

/**
 * DELETE só quando NINGUÉM usou a categoria. Com link já emitido, apagar a
 * definição deixaria o subtoken sem campos pra renderizar e as respostas
 * gravadas sem rótulo — nesse caso o caminho é desativar (PATCH active:false),
 * que some da UI de geração e mantém os links antigos legíveis.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const g = await guard(req);
  if (g.error) return g.error;
  const ctx = g.ctx;

  const existing = await prisma.formParticipantCategory.findFirst({
    where: { id: params.id, orgId: ctx.orgId },
  });
  if (!existing) {
    return NextResponse.json(
      { error: "Categoria não encontrada" },
      { status: 404 },
    );
  }

  const inUse = await prisma.salesFormParticipant.count({
    where: { role: terceiroRole(existing.slug), form: { orgId: ctx.orgId } },
  });
  if (inUse > 0) {
    return NextResponse.json(
      {
        error:
          "Categoria já usada em links por parte — desative em vez de excluir.",
        reason: "category_in_use",
        inUse,
      },
      { status: 409 },
    );
  }

  await prisma.formParticipantCategory.delete({ where: { id: existing.id } });

  audit(
    {
      orgId: ctx.orgId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    {
      action: "PARTICIPANT_CATEGORY_DELETED",
      result: "SUCCESS",
      resourceType: "FormParticipantCategory",
      resource: existing.id,
      metadata: { slug: existing.slug },
    },
  );

  return NextResponse.json({ ok: true });
}
