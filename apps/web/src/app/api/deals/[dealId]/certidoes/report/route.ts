import { NextRequest, NextResponse } from "next/server";
import os from "os";
import path from "path";
import fs from "fs";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { buildReportData, renderReportHtml } from "@/lib/certidoes/report";
import { exportPdf } from "@/lib/render/exporter";
import { uploadBufferToStorage } from "@/lib/storage/s3";

export const runtime = "nodejs";
export const maxDuration = 120;

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
    include: {
      form: { select: { orgId: true, dataJson: true } },
      certidaoJobs: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  if (deal.form && deal.form.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (deal.certidaoJobs.length === 0) {
    return NextResponse.json(
      { error: "Nao ha certidoes extraidas para este negocio" },
      { status: 400 }
    );
  }

  const dealData =
    (deal.form?.dataJson as Record<string, unknown> | null) ||
    (deal.dataJson as Record<string, unknown> | null) ||
    {};

  const vendedores = ((dealData as any).vendedores as any[]) ?? [];
  const compradores = ((dealData as any).compradores as any[]) ?? [];
  const imoveis = ((dealData as any).imoveis as any[]) ?? [];

  const partes = [
    ...vendedores.map((v: any, i: number) => ({
      key: `vendedor-${i}`,
      label: `Vendedor: ${v.nome || v.razao_social || `Parte ${i + 1}`}`,
    })),
    ...compradores.map((c: any, i: number) => ({
      key: `comprador-${i}`,
      label: `Comprador: ${c.nome || c.razao_social || `Parte ${i + 1}`}`,
    })),
  ];
  const imoveisList = imoveis.map((im: any, i: number) => {
    const parts: string[] = [];
    if (im.rua) parts.push(im.rua);
    if (im.numero && String(im.numero).trim() !== "" && String(im.numero).trim() !== "nº") {
      parts.push(`nº ${im.numero}`);
    }
    if (im.cidade) parts.push(im.cidade);
    const addr = parts.join(", ");
    return {
      key: `imovel-${i}`,
      label: `Imóvel: ${addr || `#${i + 1}`}`,
    };
  });

  const reportData = buildReportData({
    dealTitle: deal.title,
    responsavel: session.user.name || session.user.email || "Sistema",
    partes,
    imoveis: imoveisList,
    jobs: deal.certidaoJobs.map((j) => ({
      id: j.id,
      label: j.label,
      endpoint: j.endpoint,
      targetKind: j.targetKind,
      targetIndex: j.targetIndex,
      status: j.status,
      resultCode: j.resultCode,
      resultData: j.resultData,
      errorMessage: j.errorMessage,
      retryCount: j.retryCount,
      latencyMs: j.latencyMs,
      costCents: j.costCents,
    })),
  });

  const html = renderReportHtml(reportData);

  // Render PDF to a temp file then upload to storage.
  const tempPath = path.join(
    os.tmpdir(),
    `certidoes_${deal.id}_${Date.now()}.pdf`
  );
  try {
    await exportPdf(html, tempPath, "A4", null);
    const buffer = fs.readFileSync(tempPath);
    const bucket = process.env.S3_BUCKET;
    const key = `deal-certidoes/${deal.id}/relatorio_${Date.now()}.pdf`;
    const url = await uploadBufferToStorage({
      bucket,
      key,
      body: buffer,
      contentType: "application/pdf",
    });

    const attachment = await prisma.dealAttachment.create({
      data: {
        dealId: deal.id,
        filename: `Relatorio_certidoes_${deal.id.slice(0, 6)}.pdf`,
        mime: "application/pdf",
        url,
        category: "relatorio_certidoes",
        source: "infosimples",
      },
    });

    return NextResponse.json({
      attachmentId: attachment.id,
      fileUrl: `/api/deals/${deal.id}/attachments/${attachment.id}/file`,
    });
  } catch (err) {
    console.error("[certidoes/report] erro ao gerar PDF", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro ao gerar relatorio" },
      { status: 500 }
    );
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {}
  }
}
