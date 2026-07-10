import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  legalName: z.string().trim().max(200).optional(),
  cnpj: z.string().trim().max(20).optional(),
  creci: z.string().trim().max(40).optional(),
  legalAddress: z.string().trim().max(300).optional(),
  fiscalResponsibleCpf: z.string().trim().max(20).optional(),
  fiscalUf: z.string().trim().max(2).optional(),
  fiscalMunicipioCode: z.string().trim().max(10).optional(),
  fiscalMunicipioName: z.string().trim().max(120).optional(),
});

type PermissionValue = (typeof PERMISSION)[keyof typeof PERMISSION];

async function guard(
  ctx: { userId: string; orgId: string },
  permission: PermissionValue
) {
  // Impersonation-aware: sob "testar como" (mt_impersonate), o super_admin age
  // como o dono da org. requireAuth resolve o orgId impersonado (via getUserOrg)
  // mas mantém o userId real — então checar a permissão com o id efetivo, senão
  // o super_admin (não-membro) leva MembershipRequired ao salvar o perfil.
  const effUserId = await getEffectiveUserId(ctx.userId);
  await requirePermission({ userId: effUserId, orgId: ctx.orgId, permission });
}

/** GET — devolve os dados fiscais atuais do declarante. */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  try {
    await guard(ctx, PERMISSION.ORG_SETTINGS_READ);
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const org = await prisma.organization.findUnique({
    where: { id: ctx.orgId },
    select: {
      legalName: true,
      cnpj: true,
      creci: true,
      legalAddress: true,
      fiscalResponsibleCpf: true,
      fiscalUf: true,
      fiscalMunicipioCode: true,
      fiscalMunicipioName: true,
    },
  });
  return NextResponse.json(org ?? {});
}

/** PATCH — atualiza os dados fiscais (declarante DIMOB). */
export async function PATCH(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  try {
    await guard(ctx, PERMISSION.ORG_SETTINGS_EDIT);
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    json = {};
  }
  const parsed = Body.safeParse(json ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const data = parsed.data;
  // UF sempre em maiúsculas quando presente
  if (data.fiscalUf) data.fiscalUf = data.fiscalUf.toUpperCase();

  const updated = await prisma.organization.update({
    where: { id: ctx.orgId },
    data,
    select: {
      legalName: true,
      cnpj: true,
      creci: true,
      legalAddress: true,
      fiscalResponsibleCpf: true,
      fiscalUf: true,
      fiscalMunicipioCode: true,
      fiscalMunicipioName: true,
    },
  });

  await audit(extractAuditContextFromRequest(req, ctx.orgId, ctx.userId), {
    action: "FISCAL_SETTINGS_UPDATE",
    result: "SUCCESS",
    resource: ctx.orgId,
    resourceType: "Organization",
    metadata: { fields: Object.keys(data) },
  });

  return NextResponse.json(updated);
}
