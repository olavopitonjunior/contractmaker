import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

/**
 * Cadastro de testemunhas padrão do sistema (por org). A popup de envio de
 * assinatura lê `?default=1` pra injetar as testemunhas marcadas como padrão,
 * pré-preenchidas, no envelope ClickSign.
 */
const witnessSchema = z.object({
  nome: z.string().min(2, "Nome obrigatório").max(200),
  cpf: z.string().max(20).optional().nullable(),
  email: z.string().email("E-mail inválido"),
  mobilePhone: z.string().max(20).optional().nullable(),
  isDefault: z.boolean().optional().default(true),
});

const onlyDigits = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const cleaned = s.replace(/\D+/g, "");
  return cleaned.length ? cleaned : null;
};

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const onlyDefault = req.nextUrl.searchParams.get("default") === "1";
  const witnesses = await prisma.defaultWitness.findMany({
    where: { orgId: org.id, ...(onlyDefault ? { isDefault: true } : {}) },
    orderBy: [{ isDefault: "desc" }, { nome: "asc" }],
  });
  return NextResponse.json({ witnesses });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const parsed = witnessSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const created = await prisma.defaultWitness.create({
    data: {
      orgId: org.id,
      nome: parsed.data.nome.trim(),
      cpf: onlyDigits(parsed.data.cpf),
      email: parsed.data.email.trim().toLowerCase(),
      mobilePhone: onlyDigits(parsed.data.mobilePhone),
      isDefault: parsed.data.isDefault,
    },
  });
  return NextResponse.json({ witness: created }, { status: 201 });
}
