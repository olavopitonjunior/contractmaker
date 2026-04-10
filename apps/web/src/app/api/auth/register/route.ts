import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = registerSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados invalidos." },
      { status: 400 }
    );
  }

  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "Email ja cadastrado." },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: { name, email, passwordHash },
  });

  // Auto-create org and membership for new user
  const slug = email.split("@")[0].replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const org = await prisma.organization.create({
    data: {
      name: `${name}'s Workspace`,
      slug: `${slug}-${user.id.slice(0, 6)}`,
      members: {
        create: {
          userId: user.id,
          role: "owner",
        },
      },
    },
  });

  // Create default pipeline with stages
  await prisma.pipeline.create({
    data: {
      orgId: org.id,
      name: "Pipeline Principal",
      stages: {
        create: [
          { name: "Novo Lead", color: "#6366f1", position: 0 },
          { name: "Qualificacao", color: "#f59e0b", position: 1 },
          { name: "Proposta", color: "#3b82f6", position: 2 },
          { name: "Contrato", color: "#8b5cf6", position: 3 },
          { name: "Fechado Ganho", color: "#22c55e", position: 4 },
          { name: "Fechado Perdido", color: "#ef4444", position: 5 },
        ],
      },
    },
  });

  return NextResponse.json({ id: user.id, email: user.email }, { status: 201 });
}
