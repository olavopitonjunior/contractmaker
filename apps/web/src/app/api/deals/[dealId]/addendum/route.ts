/**
 * POST /api/deals/[dealId]/addendum
 *
 * F4 iteração 2026-05-17 — Cria aditamento contratual SEM passar pelo agente.
 * Usado pelo AditamentoDialog após o usuário decidir manualmente
 * (preenche considerando, objeto, alterações, intervenientes).
 *
 * O caminho via chat (Editor specialist) é alternativo — quando o usuário
 * prefere conversar e a IA monta o aditamento dinamicamente.
 *
 * Body (Zod-validated):
 *   {
 *     considerando: string (motivação resumida)
 *     objetoResumo: string
 *     alteracoes: Array<{ numero: string; texto: string }>
 *     baseLegal: string
 *     intervenientes?: Array<{ nome, papel, cpf?, cnpj?, qualificacao? }>
 *   }
 *
 * Auth: NextAuth session + cross-org guard via Deal.pipeline.orgId.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { generateAddendumForDeal } from "@/lib/services/addendum-generation";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

const AddendumRequestSchema = z.object({
  considerando: z.string().min(10).max(2000),
  objetoResumo: z.string().min(5).max(500),
  alteracoes: z
    .array(
      z.object({
        numero: z.string().min(1).max(20),
        texto: z.string().min(10).max(4000),
      })
    )
    .min(1)
    .max(20),
  baseLegal: z.string().min(5).max(1000),
  intervenientes: z
    .array(
      z.object({
        nome: z.string().min(2).max(200),
        papel: z.enum(["interveniente_anuente", "sucessor", "outro"]),
        cpf: z.string().optional(),
        cnpj: z.string().optional(),
        qualificacao: z.string().max(500).optional(),
        email: z.string().email().optional(),
      })
    )
    .max(10)
    .optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Cross-org guard
  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: { pipeline: { select: { orgId: true } } },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal não encontrado" }, { status: 404 });
  }
  // Cross-org + escopo do gerente + CONTRACT_CREATE (aditamento é contrato
  // novo). Antes esta rota só validava existência do deal — o guard fecha o
  // cross-org junto com o escopo.
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }
  const denied = await guardDealScope({
    dealId: params.dealId,
    userId: session.user.id,
    orgId: org.id,
    permission: PERMISSION.CONTRACT_CREATE,
  });
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = AddendumRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const result = await generateAddendumForDeal({
      dealId: params.dealId,
      userId: session.user.id,
      considerando: parsed.data.considerando,
      objetoResumo: parsed.data.objetoResumo,
      alteracoes: parsed.data.alteracoes,
      baseLegal: parsed.data.baseLegal,
      intervenientes: parsed.data.intervenientes,
    });

    return NextResponse.json({
      success: true,
      addendumContractId: result.addendumContractId,
      parentContractId: result.parentContractId,
      aditivoNumero: result.aditivoNumero,
      googleDocUrl: result.googleDocUrl,
      url: `/contracts/${result.addendumContractId}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /addendum] falhou:", err);

    // Erro do tipo "deal não assinado" → 422 (pré-condição não atendida)
    if (message.includes("não tem contrato assinado")) {
      return NextResponse.json(
        {
          error: "Pré-condição não atendida",
          detail:
            "Deal não tem contrato assinado. Aditamento requer Envelope source=contract status=closed.",
        },
        { status: 422 }
      );
    }

    return NextResponse.json(
      { error: "Falha ao gerar aditamento", detail: message },
      { status: 500 }
    );
  }
}
