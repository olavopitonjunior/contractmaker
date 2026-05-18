import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import { isValidCpf, onlyDigits } from "@/lib/validators/cpf";
import { normalizeBrPhone } from "@/lib/validators/phone-br";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const profileSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    phone: z
      .string()
      .trim()
      .max(40)
      .nullable()
      .optional()
      .transform((v) => (v === "" ? null : v)),
    cpf: z
      .string()
      .trim()
      .max(20)
      .nullable()
      .optional()
      .transform((v) => (v === "" ? null : v)),
    birthDate: z
      .string()
      .trim()
      .nullable()
      .optional()
      .transform((v) => (v === "" ? null : v)),
    incomeValueCents: z
      .number()
      .int()
      .min(0)
      .max(2_000_000_000)
      .nullable()
      .optional(),
    postalCode: z
      .string()
      .trim()
      .max(20)
      .nullable()
      .optional()
      .transform((v) => (v === "" ? null : v)),
    addressStreet: z.string().trim().max(200).nullable().optional(),
    addressNumber: z.string().trim().max(40).nullable().optional(),
    addressComplement: z.string().trim().max(100).nullable().optional(),
    addressNeighborhood: z.string().trim().max(100).nullable().optional(),
    addressCity: z.string().trim().max(100).nullable().optional(),
    addressState: z
      .string()
      .trim()
      .length(2)
      .nullable()
      .optional()
      .transform((v) => (v ? v.toUpperCase() : v)),
  })
  .strict();

const PROFILE_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
  phone: true,
  cpf: true,
  birthDate: true,
  incomeValueCents: true,
  postalCode: true,
  addressStreet: true,
  addressNumber: true,
  addressComplement: true,
  addressNeighborhood: true,
  addressCity: true,
  addressState: true,
} as const;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: PROFILE_SELECT,
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  return NextResponse.json({
    ...user,
    birthDate: user.birthDate ? user.birthDate.toISOString().slice(0, 10) : null,
  });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const ip = req.headers.get("x-forwarded-for") ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;

  const raw = await req.json().catch(() => ({}));
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const input = parsed.data;
  const data: Record<string, unknown> = {};

  if (input.name !== undefined) data.name = input.name;

  if (input.phone !== undefined) {
    if (input.phone === null) {
      data.phone = null;
    } else {
      const normalized = normalizeBrPhone(input.phone);
      if (!normalized) {
        return NextResponse.json(
          { error: "Telefone inválido. Use DDD + número (10 ou 11 dígitos)." },
          { status: 400 }
        );
      }
      data.phone = normalized;
    }
  }

  if (input.cpf !== undefined) {
    if (input.cpf === null) {
      data.cpf = null;
    } else {
      if (!isValidCpf(input.cpf)) {
        return NextResponse.json({ error: "CPF inválido" }, { status: 400 });
      }
      data.cpf = onlyDigits(input.cpf);
    }
  }

  if (input.birthDate !== undefined) {
    if (input.birthDate === null) {
      data.birthDate = null;
    } else {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.birthDate);
      if (!match) {
        return NextResponse.json(
          { error: "Data de nascimento inválida (use YYYY-MM-DD)" },
          { status: 400 }
        );
      }
      const [_, y, m, d] = match;
      const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
      if (Number.isNaN(dt.getTime())) {
        return NextResponse.json(
          { error: "Data de nascimento inválida" },
          { status: 400 }
        );
      }
      data.birthDate = dt;
    }
  }

  if (input.incomeValueCents !== undefined) data.incomeValueCents = input.incomeValueCents;

  if (input.postalCode !== undefined) {
    if (input.postalCode === null) {
      data.postalCode = null;
    } else {
      const cep = onlyDigits(input.postalCode);
      if (cep.length !== 8) {
        return NextResponse.json(
          { error: "CEP deve ter 8 dígitos" },
          { status: 400 }
        );
      }
      data.postalCode = cep;
    }
  }

  for (const key of [
    "addressStreet",
    "addressNumber",
    "addressComplement",
    "addressNeighborhood",
    "addressCity",
    "addressState",
  ] as const) {
    if (input[key] !== undefined) data[key] = input[key];
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  try {
    const updated = await prisma.user.update({
      where: { id: userId },
      data,
      select: PROFILE_SELECT,
    });
    const org = await getUserOrg(userId).catch(() => null);
    await audit(
      {
        orgId: org?.id ?? "system",
        userId,
        ipAddress: ip,
        userAgent,
      },
      {
        action: "USER_PROFILE_UPDATE",
        result: "SUCCESS",
        resourceType: "user",
        resource: `user:${userId}`,
        metadata: { fields: Object.keys(data) },
      }
    ).catch(() => {});
    return NextResponse.json({
      ...updated,
      birthDate: updated.birthDate
        ? updated.birthDate.toISOString().slice(0, 10)
        : null,
    });
  } catch (err: unknown) {
    const errCode =
      typeof err === "object" && err !== null && "code" in err
        ? (err as { code?: string }).code
        : undefined;
    if (errCode === "P2002") {
      return NextResponse.json(
        { error: "CPF ou telefone já cadastrado em outra conta" },
        { status: 409 }
      );
    }
    console.error("[me/profile] update fail", err);
    return NextResponse.json(
      { error: "Falha ao atualizar perfil" },
      { status: 500 }
    );
  }
}
