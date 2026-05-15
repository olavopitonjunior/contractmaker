import { NextRequest, NextResponse } from "next/server";
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

const patchSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  cpfCnpj: z.string().trim().min(11).max(18).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  email: z
    .string()
    .trim()
    .email("Email inválido")
    .max(200)
    .nullable()
    .optional()
    .or(z.literal("")),
  active: z.boolean().optional(),
  // Aditivos 2026-05-16 — cadastro reutilizável de comissionado.
  kind: z.enum(["commissioner", "other"]).nullable().optional(),
  tipoPessoa: z.enum(["fisica", "juridica"]).nullable().optional(),
  creci: z.string().trim().max(50).nullable().optional(),
  papel: z
    .enum([
      "imobiliaria_principal",
      "captador",
      "intermediador",
      "indicador",
      "outro",
    ])
    .nullable()
    .optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  bankName: z.string().trim().max(80).nullable().optional(),
  bankBranch: z.string().trim().max(20).nullable().optional(),
  bankAccount: z.string().trim().max(30).nullable().optional(),
  bankAccountType: z.enum(["corrente", "poupanca"]).nullable().optional(),
  bankHolderName: z.string().trim().max(200).nullable().optional(),
  bankHolderDoc: z.string().trim().max(18).nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { id } = await params;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.SPLIT_CONFIGURE,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const existing = await prisma.splitRecipient.findFirst({
    where: { id, orgId: ctx.orgId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Recipient não encontrado" }, { status: 404 });
  }

  const updated = await prisma.splitRecipient.update({
    where: { id },
    data: parsed.data,
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    {
      action: "SPLIT_RECIPIENT_UPDATED",
      result: "SUCCESS",
      resourceType: "split_recipient",
      resource: `split_recipient:${updated.id}`,
      metadata: parsed.data,
    }
  );

  return NextResponse.json({ recipient: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { id } = await params;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.SPLIT_CONFIGURE,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const existing = await prisma.splitRecipient.findFirst({
    where: { id, orgId: ctx.orgId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Recipient não encontrado" }, { status: 404 });
  }

  // Soft delete — preserva histórico de splits que já referenciam esse walletId
  const updated = await prisma.splitRecipient.update({
    where: { id },
    data: { active: false },
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    {
      action: "SPLIT_RECIPIENT_DELETED",
      result: "SUCCESS",
      resourceType: "split_recipient",
      resource: `split_recipient:${updated.id}`,
    }
  );

  return NextResponse.json({ recipient: updated });
}
