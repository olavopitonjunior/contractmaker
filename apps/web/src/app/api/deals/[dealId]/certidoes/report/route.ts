import { NextRequest, NextResponse } from "next/server";
import os from "os";
import path from "path";
import fs from "fs";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { buildReportData, renderReportHtml } from "@/lib/certidoes/report";
import { exportPdf } from "@/lib/render/exporter";
import { uploadBufferToStorage } from "@/lib/storage/s3";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";

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
      // org via pipeline (form pode ser null em deal formless — IDOR)
      pipeline: { select: { orgId: true } },
      // Exclui tentativas substituídas (replaced) — o relatório mostra só a
      // tentativa viva de cada alvo, igual à lista consolidada da UI.
      certidaoJobs: {
        where: { status: { not: "replaced" } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  if (deal.pipeline.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Escopo do gerente + DEAL_EDIT (gera e persiste o PDF do relatório).
  const denied = await guardDealScope({
    dealId: params.dealId,
    userId: session.user.id,
    orgId: org.id,
    permission: PERMISSION.DEAL_EDIT,
  });
  if (denied) return denied;

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

  const isLocacao = deal.kind === "locacao";
  const vendedores = ((dealData as any).vendedores as any[]) ?? [];
  const compradores = ((dealData as any).compradores as any[]) ?? [];
  const locatarios = ((dealData as any).locatarios as any[]) ?? [];
  const locadores = ((dealData as any).locadores as any[]) ?? [];
  // Mesma regra do planner (collectTargets): fiador só quando a garantia É fiança.
  const fiador =
    (dealData as any).garantia?.tipo === "fiador"
      ? ((dealData as any).garantia?.fiador as any | undefined)
      : undefined;
  // Locação tem UM imóvel (objeto); a chave de agrupamento continua `imovel-0`.
  const imoveis: any[] = isLocacao
    ? (dealData as any).imovel
      ? [(dealData as any).imovel]
      : []
    : (((dealData as any).imoveis as any[]) ?? []);

  const nomeDe = (p: any, i: number) => p?.nome || p?.razao_social || `Parte ${i + 1}`;
  // Chave de agrupamento = `${targetKind}-${targetIndex}` (ver buildReportData).
  const keyOf = (kind: string, i: number) => `${kind}-${i}`;
  const partes = isLocacao
    ? [
        ...locatarios.map((p: any, i: number) => ({
          key: keyOf("locatario", i),
          label: `Locatário: ${nomeDe(p, i)}`,
        })),
        ...(fiador
          ? [
              { key: keyOf("fiador", 0), label: `Fiador: ${nomeDe(fiador, 0)}` },
              ...(fiador.conjuge?.nome
                ? [{ key: keyOf("conjuge_fiador", 0), label: `Cônjuge do fiador: ${fiador.conjuge.nome}` }]
                : []),
            ]
          : []),
        ...locadores.map((p: any, i: number) => ({
          key: keyOf("locador", i),
          label: `Locador: ${nomeDe(p, i)}`,
        })),
      ]
    : [
        ...vendedores.map((v: any, i: number) => ({
          key: `vendedor-${i}`,
          label: `Vendedor: ${nomeDe(v, i)}`,
        })),
        ...compradores.map((c: any, i: number) => ({
          key: `comprador-${i}`,
          label: `Comprador: ${nomeDe(c, i)}`,
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
    // Cleanup best-effort do arquivo temporário (pode já não existir).
    try {
      fs.unlinkSync(tempPath);
    } catch (e) {
      console.warn("[certidoes/report] falha ao remover temp", e);
    }
  }
}
