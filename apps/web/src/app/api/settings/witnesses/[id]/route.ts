import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

const patchSchema = z.object({
  nome: z.string().min(2).max(200).optional(),
  cpf: z.string().max(20).optional().nullable(),
  email: z.string().email("E-mail inválido").optional(),
  mobilePhone: z.string().max(20).optional().nullable(),
  isDefault: z.boolean().optional(),
});

const onlyDigits = (s: string | null | undefined): string | null => {
  if (s == null) return null;
  const cleaned = s.replace(/\D+/g, "");
  return cleaned.length ? cleaned : null;
};

async function resolveOrgWitness(userId: string, id: string) {
  const org = await getUserOrg(userId);
  if (!org) return { org: null, witness: null };
  const witness = await prisma.defaultWitness.findFirst({
    where: { id, orgId: org.id },
  });
  return { org, witness };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { org, witness } = await resolveOrgWitness(session.user.id, params.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });
  if (!witness) {
    return NextResponse.json({ error: "Testemunha não encontrada" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const updated = await prisma.defaultWitness.update({
    where: { id: witness.id },
    data: {
      ...(data.nome !== undefined ? { nome: data.nome.trim() } : {}),
      ...(data.cpf !== undefined ? { cpf: onlyDigits(data.cpf) } : {}),
      ...(data.email !== undefined
        ? { email: data.email.trim().toLowerCase() }
        : {}),
      ...(data.mobilePhone !== undefined
        ? { mobilePhone: onlyDigits(data.mobilePhone) }
        : {}),
      ...(data.isDefault !== undefined ? { isDefault: data.isDefault } : {}),
    },
  });
  return NextResponse.json({ witness: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { org, witness } = await resolveOrgWitness(session.user.id, params.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });
  if (!witness) {
    return NextResponse.json({ error: "Testemunha não encontrada" }, { status: 404 });
  }

  await prisma.defaultWitness.delete({ where: { id: witness.id } });
  return NextResponse.json({ ok: true });
}
