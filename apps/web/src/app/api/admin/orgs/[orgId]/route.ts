import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { requirePlatform } from "@/lib/admin/gate";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const deleteSchema = z.object({ confirm: z.string().min(1) });

// Dados cadastrais editáveis pelo super_admin. `.nullish()` permite limpar (null).
const patchSchema = z.object({
  legalName: z.string().trim().max(200).nullish(),
  cnpj: z.string().trim().max(20).nullish(),
  creci: z.string().trim().max(40).nullish(),
  legalAddress: z.string().trim().max(300).nullish(),
});

const PATCHABLE_FIELDS = ["legalName", "cnpj", "creci", "legalAddress"] as const;

/**
 * PATCH /api/admin/orgs/[orgId] — atualiza dados cadastrais da imobiliária
 * (super_admin). razão social / CNPJ / CRECI / endereço aparecem na cláusula da
 * administradora dos contratos de locação. Grava só as chaves presentes no body
 * (null limpa o campo).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { orgId: string } }
) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "super_admin");
  if (!g.ok) return g.res;

  const org = await prisma.organization.findUnique({
    where: { id: params.orgId },
    select: { id: true },
  });
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validação falhou", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data: Record<string, string | null> = {};
  for (const k of PATCHABLE_FIELDS) {
    if (k in parsed.data) data[k] = parsed.data[k] ?? null;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nenhum campo para atualizar" }, { status: 400 });
  }

  const updated = await prisma.organization.update({
    where: { id: org.id },
    data,
    select: { id: true, legalName: true, cnpj: true, creci: true, legalAddress: true },
  });

  await audit(extractAuditContextFromRequest(req, org.id, session!.user!.id), {
    action: "ORG_UPDATED",
    result: "SUCCESS",
    resourceType: "Organization",
    resource: org.id,
    metadata: { fields: Object.keys(data) },
  });

  return NextResponse.json({ ok: true, org: updated });
}

/**
 * DELETE /api/admin/orgs/[orgId] — exclusão DESTRUTIVA de tenant (super_admin).
 *
 * Exige `{ confirm }` igual ao subdomínio (ou slug) da org. Bloqueia se houver
 * envelope ClickSign em voo (`running`) — assinatura em andamento não deve ser
 * interrompida. A cascata do banco (onDelete: Cascade nas FKs de org) remove
 * pipelines→deals→contracts, cobranças, certidões, etc. Usuários NÃO são
 * apagados (são plataforma-wide via OrgMembership). Irreversível.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { orgId: string } }
) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "super_admin");
  if (!g.ok) return g.res;

  const org = await prisma.organization.findUnique({
    where: { id: params.orgId },
    select: { id: true, name: true, slug: true, subdomain: true },
  });
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 });

  const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "confirm obrigatório" }, { status: 400 });
  }
  const expected = org.subdomain ?? org.slug;
  if (parsed.data.confirm.trim() !== expected) {
    return NextResponse.json(
      { error: "CONFIRM_MISMATCH", message: `Digite "${expected}" para confirmar.` },
      { status: 400 }
    );
  }

  const running = await prisma.envelope.count({
    where: { orgId: org.id, status: "running" },
  });
  if (running > 0) {
    return NextResponse.json(
      {
        error: "ENVELOPE_RUNNING",
        message: `${running} envelope(s) em assinatura. Cancele antes de excluir o tenant.`,
      },
      { status: 409 }
    );
  }

  // Snapshot leve pra auditoria antes de destruir.
  const counts = {
    pipelines: await prisma.pipeline.count({ where: { orgId: org.id } }),
    members: await prisma.orgMembership.count({ where: { orgId: org.id } }),
    asaasAccounts: await prisma.asaasAccount.count({ where: { orgId: org.id } }),
  };

  // Audita ANTES de apagar. Gravamos orgId=null porque a row de AuditLog tem
  // onDelete:Cascade na FK de org — manter o orgId real apagaria o próprio log
  // junto da org. Reusa o helper só pra ip/userAgent e nula o orgId.
  await audit(
    { ...extractAuditContextFromRequest(req, org.id, session!.user!.id), orgId: null },
    {
    action: "ORG_DELETED",
    result: "SUCCESS",
    resourceType: "Organization",
    resource: org.id,
    metadata: { name: org.name, subdomain: org.subdomain, slug: org.slug, counts },
  });

  // Zera a self-FK activeAsaasAccountId antes do delete pra evitar conflito de
  // ordem na cascata (org → AsaasAccount), depois apaga a org (cascata cuida do resto).
  await prisma.$transaction([
    prisma.organization.update({
      where: { id: org.id },
      data: { activeAsaasAccountId: null },
    }),
    prisma.organization.delete({ where: { id: org.id } }),
  ]);

  return NextResponse.json({ ok: true, deleted: org.id });
}
