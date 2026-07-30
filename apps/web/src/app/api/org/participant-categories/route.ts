import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
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
  categoryAppliesToSchema,
  categoryFieldsSchema,
  categorySlugSchema,
  slugifyCategoryLabel,
} from "@/lib/forms/participant-category";
import { listOrgParticipantCategories } from "@/lib/forms/participant-category-repo";

/**
 * CRUD das categorias de TERCEIRO do formulário público (link por parte com
 * campos definidos pela imobiliária). Ver lib/forms/participant-category.ts.
 *
 * Leitura: qualquer membro (a lista alimenta o painel de links do form, que
 * qualquer corretor abre). Escrita: ORG_SETTINGS_EDIT, como o resto de
 * /settings/formulario.
 */

const createSchema = z.object({
  label: z.string().min(2).max(60),
  // Sem slug explícito, deriva do label — a UI não precisa expor o campo.
  slug: categorySlugSchema.optional(),
  description: z.string().max(300).optional(),
  appliesTo: categoryAppliesToSchema,
  fields: categoryFieldsSchema.default([]),
});

export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const url = new URL(req.url);
  const activeOnly = url.searchParams.get("active") === "true";
  const categories = await listOrgParticipantCategories(ctx.orgId, {
    activeOnly,
  });

  return NextResponse.json({ categories });
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
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
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const slug = parsed.data.slug ?? slugifyCategoryLabel(parsed.data.label);
  const slugCheck = categorySlugSchema.safeParse(slug);
  if (!slugCheck.success) {
    return NextResponse.json(
      { error: "Não foi possível derivar um identificador do nome — informe o slug" },
      { status: 400 },
    );
  }

  try {
    const created = await prisma.formParticipantCategory.create({
      data: {
        orgId: ctx.orgId,
        slug,
        label: parsed.data.label,
        description: parsed.data.description || null,
        appliesTo: parsed.data.appliesTo,
        fields: parsed.data.fields,
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
        action: "PARTICIPANT_CATEGORY_CREATED",
        result: "SUCCESS",
        resourceType: "FormParticipantCategory",
        resource: created.id,
        metadata: { slug, appliesTo: parsed.data.appliesTo },
      },
    );

    return NextResponse.json({
      category: {
        id: created.id,
        slug: created.slug,
        label: created.label,
        description: created.description,
        appliesTo: created.appliesTo,
        fields: created.fields,
        active: created.active,
      },
    });
  } catch (err) {
    // @@unique([orgId, slug]) — duas categorias com o mesmo identificador
    // gerariam roles ambíguos e paths colidentes no dataJson.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: `Já existe uma categoria com o identificador "${slug}"` },
        { status: 409 },
      );
    }
    throw err;
  }
}
