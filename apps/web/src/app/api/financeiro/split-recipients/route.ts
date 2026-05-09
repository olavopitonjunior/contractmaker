import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { detectPixKeyType } from "@/lib/asaas/pix";

const baseSchema = z.object({
  label: z.string().trim().min(1).max(120),
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
});

const walletSchema = baseSchema.extend({
  recipientType: z.literal("asaas_wallet").default("asaas_wallet"),
  walletId: z.string().trim().min(1).max(200),
});

const pixSchema = baseSchema.extend({
  recipientType: z.literal("pix_external"),
  pixAddressKey: z.string().trim().min(1).max(200),
  ownerName: z.string().trim().min(1).max(200),
  ownerCpfCnpj: z.string().trim().min(11).max(18),
});

const createSchema = z.discriminatedUnion("recipientType", [walletSchema, pixSchema]);

export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.SPLIT_VIEW,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const recipients = await prisma.splitRecipient.findMany({
    where: { orgId: ctx.orgId },
    orderBy: [{ active: "desc" }, { label: "asc" }],
  });

  return NextResponse.json({ recipients });
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

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
  // Default recipientType pra asaas_wallet quando ausente (back-compat com clients antigos)
  if (!raw.recipientType) raw.recipientType = "asaas_wallet";
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const isPix = data.recipientType === "pix_external";

  // Para PIX, detectar tipo da chave automaticamente
  let pixKeyType: string | null = null;
  if (isPix) {
    pixKeyType = detectPixKeyType(data.pixAddressKey);
    if (!pixKeyType) {
      return NextResponse.json(
        { error: "Chave PIX inválida — formato não reconhecido (use CPF, CNPJ, email, telefone ou EVP)" },
        { status: 400 }
      );
    }
  }

  try {
    const created = await prisma.splitRecipient.create({
      data: {
        orgId: ctx.orgId,
        label: data.label,
        recipientType: data.recipientType,
        walletId: isPix ? null : data.walletId,
        pixAddressKey: isPix ? data.pixAddressKey : null,
        pixKeyType: pixKeyType,
        ownerName: isPix ? data.ownerName : null,
        ownerCpfCnpj: isPix ? data.ownerCpfCnpj : null,
        cpfCnpj: data.cpfCnpj ?? null,
        description: data.description ?? null,
        email: data.email && data.email !== "" ? data.email : null,
      },
    });

    await audit(
      { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      {
        action: "SPLIT_RECIPIENT_CREATED",
        result: "SUCCESS",
        resourceType: "split_recipient",
        resource: `split_recipient:${created.id}`,
        metadata: {
          label: created.label,
          recipientType: created.recipientType,
          walletId: created.walletId ?? undefined,
          pixKeyType: created.pixKeyType ?? undefined,
        },
      }
    );

    return NextResponse.json({ recipient: created }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = (err.meta?.target as string[] | undefined) ?? [];
      const dupField = target.includes("pixAddressKey") ? "Chave PIX" : "Wallet ID";
      return NextResponse.json(
        { error: `${dupField} já cadastrado nesta organização` },
        { status: 409 }
      );
    }
    throw err;
  }
}
