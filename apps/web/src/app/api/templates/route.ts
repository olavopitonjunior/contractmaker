import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";

const createTemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  handlebarsSource: z.string().min(1),
  modalidade: z.string().optional(),
  isDefault: z.boolean().optional(),
  version: z.string().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const templates = await prisma.contractTemplate.findMany({
    where: { orgId: org.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(templates);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = createTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const template = await prisma.contractTemplate.create({
    data: {
      orgId: org.id,
      name: parsed.data.name,
      description: parsed.data.description || "",
      handlebarsSource: parsed.data.handlebarsSource,
      modalidade: parsed.data.modalidade || "a_vista",
      isDefault: parsed.data.isDefault ?? false,
      version: parsed.data.version || "1.0.0",
      schemaType: "compra_venda_v2",
      status: "active",
    },
  });

  return NextResponse.json(template, { status: 201 });
}
