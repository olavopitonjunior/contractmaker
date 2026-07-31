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
import { GARANTIA_TIPOS } from "@/lib/contracts/template-category";
import {
  listGarantiaOptions,
  seedDefaultGarantiaOptions,
} from "@/lib/forms/garantia-option-repo";

/**
 * CRUD do catálogo de GARANTIAS locatícias da org (ver GarantiaOption no
 * schema). O formulário público NÃO consome esta rota — ele é anônimo e recebe
 * o catálogo server-side pela própria page. Aqui é só a tela de configuração.
 *
 * Leitura: qualquer membro. Escrita: ORG_SETTINGS_EDIT, como o resto de
 * /settings/formulario.
 */

const createSchema = z.object({
  tipo: z.enum(GARANTIA_TIPOS),
  provider: z.string().max(120).default(""),
  label: z.string().max(120).optional(),
  position: z.number().int().min(0).max(999).optional(),
});

export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const url = new URL(req.url);
  const activeOnly = url.searchParams.get("active") === "true";
  const options = await listGarantiaOptions(ctx.orgId, { activeOnly });
  return NextResponse.json({ options });
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
  const provider = parsed.data.provider.trim();

  // Primeira gravação de uma org que estava nos DEFAULTS: materializa o padrão
  // antes de acrescentar. Sem isso, cadastrar "Pottencial Seguros" faria os 4
  // defaults SUMIREM do formulário (a org deixa de estar vazia) — o admin veria
  // o catálogo encolher em vez de crescer.
  const existing = await prisma.garantiaOption.count({ where: { orgId: ctx.orgId } });
  if (existing === 0) await seedDefaultGarantiaOptions(ctx.orgId);

  try {
    const created = await prisma.garantiaOption.create({
      data: {
        orgId: ctx.orgId,
        tipo: parsed.data.tipo,
        provider,
        label: parsed.data.label?.trim() || null,
        position: parsed.data.position ?? 100,
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
        action: "GARANTIA_OPTION_CREATED",
        result: "SUCCESS",
        resourceType: "GarantiaOption",
        resource: created.id,
        metadata: { tipo: created.tipo, provider: created.provider },
      },
    );

    return NextResponse.json({
      option: {
        id: created.id,
        tipo: created.tipo,
        provider: created.provider,
        label: created.label,
        active: created.active,
        position: created.position,
      },
    });
  } catch (err) {
    // @@unique([orgId, tipo, provider]) — o mesmo par viraria duas opções
    // idênticas no select do formulário.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Essa combinação de garantia e garantidor já está cadastrada" },
        { status: 409 },
      );
    }
    throw err;
  }
}
