import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { generateFormSummaryPdf } from "@/lib/forms/form-summary-pdf";
import { persistFormSummaryPdf } from "@/lib/forms/form-summary-mailer";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Gera o PDF consolidado do formulário do deal (venda e locação), persiste
 * como DealAttachment (update-in-place por dealId+source) e devolve o binário
 * com Content-Disposition attachment.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    select: {
      id: true,
      kind: true,
      formId: true,
      pipeline: { select: { orgId: true } },
    },
  });
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  if (deal.pipeline.orgId !== org.id) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  // Escopo do gerente + DEAL_EDIT (gera e persiste o PDF do resumo).
  const denied = await guardDealScope({
    dealId: params.dealId,
    userId: session.user.id,
    orgId: org.id,
    permission: PERMISSION.DEAL_EDIT,
  });
  if (denied) return denied;

  if (deal.kind !== "venda" && deal.kind !== "locacao") {
    return NextResponse.json(
      { error: "Resumo consolidado disponível apenas para negócios de venda e locação" },
      { status: 400 }
    );
  }
  if (!deal.formId) {
    return NextResponse.json({ error: "Negócio sem formulário vinculado" }, { status: 400 });
  }

  try {
    const pdf = await generateFormSummaryPdf(deal.formId);
    await persistFormSummaryPdf(deal.id, deal.formId, pdf.buffer, pdf.filename);
    // Binário direto, não JSON com a URL do blob: o download no cliente fica
    // same-origin (sem popup blocker, sem depender de CORS do blob) e com o
    // nome amigável; a URL pública do blob também deixa de vazar pro browser.
    return new NextResponse(new Uint8Array(pdf.buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${pdf.filename}"`,
      },
    });
  } catch (err) {
    console.error("[form-summary/pdf] erro", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro ao gerar PDF" },
      { status: 500 }
    );
  }
}
