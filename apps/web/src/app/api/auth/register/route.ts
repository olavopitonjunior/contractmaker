import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";

const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
});

export async function POST(request: Request) {
  const sharedOrgId = process.env.SHARED_ORG_ID;
  if (!sharedOrgId) {
    return NextResponse.json(
      { error: "Cadastro temporariamente indisponível." },
      { status: 503 }
    );
  }

  const body = await request.json();
  const parsed = registerSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos. A senha precisa ter ao menos 8 caracteres." },
      { status: 400 }
    );
  }

  const name = parsed.data.name.trim();
  const email = parsed.data.email.toLowerCase().trim();
  const { password } = parsed.data;

  const sharedOrg = await prisma.organization.findUnique({
    where: { id: sharedOrgId },
    select: { id: true },
  });
  if (!sharedOrg) {
    return NextResponse.json(
      { error: "Cadastro temporariamente indisponível." },
      { status: 503 }
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "Este email já está cadastrado." },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      orgMemberships: {
        create: { orgId: sharedOrg.id, role: "member" },
      },
    },
    select: { id: true, email: true },
  });

  return NextResponse.json({ id: user.id, email: user.email }, { status: 201 });
}
