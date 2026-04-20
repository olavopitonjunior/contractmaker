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
import { decryptSecret } from "@/lib/security/crypto";
import { AsaasError } from "@/lib/asaas/errors";
import { upsertCustomer } from "@/lib/asaas/customers";

const querySchema = z.object({
  search: z.string().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const createSchema = z.object({
  name: z.string().min(2),
  cpfCnpj: z.string().min(11),
  email: z.string().email().optional(),
  mobilePhone: z.string().optional(),
  address: z
    .object({
      address: z.string().optional(),
      addressNumber: z.string().optional(),
      complement: z.string().optional(),
      province: z.string().optional(),
      postalCode: z.string().optional(),
    })
    .optional(),
});

export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Query inválida" }, { status: 400 });
  const q = parsed.data;

  const where: any = { orgId: ctx.orgId };
  if (q.search) {
    where.OR = [
      { name: { contains: q.search, mode: "insensitive" } },
      { cpfCnpj: { contains: q.search.replace(/\D/g, "") } },
      { email: { contains: q.search, mode: "insensitive" } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.asaasCustomer.count({ where }),
    prisma.asaasCustomer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: q.offset,
      take: q.limit,
      include: {
        _count: { select: { charges: true } },
      },
    }),
  ]);

  // Aggregate de totais pagos por cliente
  const totalsPaid = await prisma.commissionCharge.groupBy({
    by: ["asaasCustomerId"],
    where: { orgId: ctx.orgId, status: { in: ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"] } },
    _sum: { value: true },
  });
  const paidMap = new Map(totalsPaid.map((t) => [t.asaasCustomerId, t._sum.value ?? 0]));

  return NextResponse.json({
    total,
    offset: q.offset,
    limit: q.limit,
    rows: rows.map((c) => ({
      id: c.id,
      asaasId: c.asaasId,
      name: c.name,
      cpfCnpj: c.cpfCnpj,
      email: c.email,
      mobilePhone: c.mobilePhone,
      origin: c.origin,
      chargesCount: c._count.charges,
      totalPaid: paidMap.get(c.id) ?? 0,
      createdAt: c.createdAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.CUSTOMER_CREATE,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const account = await prisma.asaasAccount.findUnique({ where: { orgId: ctx.orgId } });
  if (!account || account.status !== "APPROVED") {
    return NextResponse.json(
      { error: "Conta Asaas não aprovada" },
      { status: 422 }
    );
  }
  const apiKey = decryptSecret({
    ciphertext: account.apiKeyEncrypted,
    iv: account.apiKeyIvBase64,
    tag: account.apiKeyTagBase64,
  });

  try {
    const asaasCustomer = await upsertCustomer({
      input: {
        name: parsed.data.name,
        cpfCnpj: parsed.data.cpfCnpj,
        email: parsed.data.email,
        mobilePhone: parsed.data.mobilePhone,
        address: parsed.data.address?.address,
        addressNumber: parsed.data.address?.addressNumber,
        complement: parsed.data.address?.complement,
        province: parsed.data.address?.province,
        postalCode: parsed.data.address?.postalCode,
      },
      apiKey,
    });

    const cpfCnpjDigits = asaasCustomer.cpfCnpj.replace(/\D/g, "");
    const local = await prisma.asaasCustomer.upsert({
      where: { orgId_cpfCnpj: { orgId: ctx.orgId, cpfCnpj: cpfCnpjDigits } },
      create: {
        orgId: ctx.orgId,
        asaasId: asaasCustomer.id,
        name: asaasCustomer.name,
        cpfCnpj: cpfCnpjDigits,
        email: asaasCustomer.email ?? null,
        mobilePhone: asaasCustomer.mobilePhone ?? null,
        origin: "manual",
        lastSyncedAt: new Date(),
      },
      update: {
        asaasId: asaasCustomer.id,
        name: asaasCustomer.name,
        email: asaasCustomer.email ?? undefined,
        mobilePhone: asaasCustomer.mobilePhone ?? undefined,
        lastSyncedAt: new Date(),
      },
    });

    await audit(
      { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      {
        action: "CHARGE_CREATE",
        result: "SUCCESS",
        resourceType: "asaas_customer",
        resource: `asaas_customer:${local.id}`,
        metadata: { asaasId: asaasCustomer.id },
      }
    );

    return NextResponse.json({ customer: local });
  } catch (err) {
    if (err instanceof AsaasError) {
      return NextResponse.json(
        { error: "ASAAS_ERROR", details: err.errors },
        { status: 422 }
      );
    }
    throw err;
  }
}
