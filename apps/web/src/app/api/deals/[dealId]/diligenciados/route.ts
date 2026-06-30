import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

async function authorizeDeal(dealId: string) {
  const session = await auth();
  if (!session?.user) return { error: "Unauthorized", status: 401 as const };
  const org = await getUserOrg(session.user.id);
  if (!org) return { error: "No organization", status: 400 as const };
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      form: { select: { orgId: true } },
      // org via pipeline (form pode ser null em deal formless — IDOR)
      pipeline: { select: { orgId: true } },
    },
  });
  if (!deal) return { error: "Deal not found", status: 404 as const };
  if (deal.pipeline.orgId !== org.id) {
    return { error: "Forbidden", status: 403 as const };
  }
  return { deal, org, userId: session.user.id };
}

/**
 * GET /api/deals/:dealId/diligenciados
 * Lists all external persons flagged for due diligence on this deal.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const authResult = await authorizeDeal(params.dealId);
  if ("error" in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const items = await prisma.diligentedPerson.findMany({
    where: { dealId: params.dealId },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ items });
}

const createSchema = z.object({
  tipoPessoa: z.enum(["fisica", "juridica"]),
  nome: z.string().min(1).max(200),
  cpf: z.string().optional().nullable(),
  cnpj: z.string().optional().nullable(),
  dataNascimento: z.string().optional().nullable(),
  // PF — destravam TJSP (rg+sexo) e antecedentes (nomeMae+nascimento).
  rg: z.string().max(40).optional().nullable(),
  nomeMae: z.string().max(200).optional().nullable(),
  sexo: z.string().max(20).optional().nullable(),
  uf: z.string().max(2).optional().nullable(),
  cidade: z.string().optional().nullable(),
  relacao: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

/**
 * POST /api/deals/:dealId/diligenciados
 * Body: { tipoPessoa, nome, cpf?, cnpj?, dataNascimento?, uf?, cidade?, relacao?, notes? }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const authResult = await authorizeDeal(params.dealId);
  if ("error" in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }
  const { userId } = authResult;

  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const sanitize = (s: string | null | undefined): string | null => {
    if (!s) return null;
    const digits = s.replace(/\D/g, "");
    return digits || null;
  };

  const created = await prisma.diligentedPerson.create({
    data: {
      dealId: params.dealId,
      tipoPessoa: parsed.data.tipoPessoa,
      nome: parsed.data.nome.trim(),
      cpf: sanitize(parsed.data.cpf ?? null),
      cnpj: sanitize(parsed.data.cnpj ?? null),
      dataNascimento: parsed.data.dataNascimento?.trim() || null,
      // RG aceita letra/dígito-verificador (ex.: "X") → não sanitiza p/ só dígitos.
      rg: parsed.data.rg?.trim() || null,
      nomeMae: parsed.data.nomeMae?.trim() || null,
      sexo: parsed.data.sexo?.trim().toLowerCase() || null,
      uf: parsed.data.uf?.trim().toUpperCase() || null,
      cidade: parsed.data.cidade?.trim() || null,
      relacao: parsed.data.relacao?.trim() || null,
      notes: parsed.data.notes?.trim() || null,
      createdBy: userId,
    },
  });

  return NextResponse.json({ item: created }, { status: 201 });
}
