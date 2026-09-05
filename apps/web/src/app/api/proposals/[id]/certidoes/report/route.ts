import { NextRequest, NextResponse } from "next/server";
import os from "os";
import path from "path";
import fs from "fs";
import { prisma } from "@/lib/db/prisma";
import { buildReportData, renderReportHtml } from "@/lib/certidoes/report";
import { exportPdf } from "@/lib/render/exporter";
import { uploadBufferToStorage } from "@/lib/storage/s3";
import { loadProposalCertidoesScope } from "@/lib/certidoes/proposal-subject";
import { persistProposalDocument } from "@/lib/proposals/attachments";

export const runtime = "nodejs";
export const maxDuration = 120;

type AnyRec = Record<string, unknown>;
const arr = (v: unknown): AnyRec[] => (Array.isArray(v) ? (v as AnyRec[]) : []);
const rec = (v: unknown): AnyRec => (v && typeof v === "object" ? (v as AnyRec) : {});
const nomeDe = (p: AnyRec, i: number) => String(p.nome || p.razao_social || `Parte ${i + 1}`);

/** POST /api/proposals/:id/certidoes/report — PDF consolidado, anexado à proposta. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadProposalCertidoesScope(req, params.id, { write: true });
  if ("fail" in r) return r.fail;
  const { scope } = r;

  const jobs = await prisma.certidaoJob.findMany({
    where: { proposalId: scope.proposal.id, status: { not: "replaced" } },
    orderBy: { createdAt: "desc" },
  });
  if (jobs.length === 0) {
    return NextResponse.json({ error: "Nao ha certidoes extraidas para esta proposta" }, { status: 400 });
  }

  const d = scope.dataJson;
  const isLocacao = scope.esteira === "locacao";
  const garantia = rec(d.garantia);
  const fiador = garantia.tipo === "fiador" ? rec(garantia.fiador) : null;
  const keyOf = (kind: string, i: number) => `${kind}-${i}`;
  const partes = isLocacao
    ? [
        ...arr(d.locatarios).map((p, i) => ({ key: keyOf("locatario", i), label: `Locatário: ${nomeDe(p, i)}` })),
        ...(fiador && Object.keys(fiador).length > 0
          ? [
              { key: keyOf("fiador", 0), label: `Fiador: ${nomeDe(fiador, 0)}` },
              ...(rec(fiador.conjuge).nome
                ? [{ key: keyOf("conjuge_fiador", 0), label: `Cônjuge do fiador: ${String(rec(fiador.conjuge).nome)}` }]
                : []),
            ]
          : []),
        ...arr(d.locadores).map((p, i) => ({ key: keyOf("locador", i), label: `Locador: ${nomeDe(p, i)}` })),
      ]
    : [
        ...arr(d.vendedores).map((p, i) => ({ key: keyOf("vendedor", i), label: `Vendedor: ${nomeDe(p, i)}` })),
        ...arr(d.compradores).map((p, i) => ({ key: keyOf("comprador", i), label: `Comprador: ${nomeDe(p, i)}` })),
      ];
  const imoveis = isLocacao ? (d.imovel ? [rec(d.imovel)] : []) : arr(d.imoveis);
  const imoveisList = imoveis.map((im, i) => {
    const parts: string[] = [];
    if (im.rua) parts.push(String(im.rua));
    if (im.endereco && !im.rua) parts.push(String(im.endereco));
    if (im.numero && String(im.numero).trim() && String(im.numero).trim() !== "nº") parts.push(`nº ${im.numero}`);
    if (im.cidade) parts.push(String(im.cidade));
    return { key: `imovel-${i}`, label: `Imóvel: ${parts.join(", ") || `#${i + 1}`}` };
  });

  const reportData = buildReportData({
    dealTitle: scope.proposal.title,
    responsavel: scope.userEmail ?? "Sistema",
    partes,
    imoveis: imoveisList,
    jobs: jobs.map((j) => ({
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

  const tempPath = path.join(os.tmpdir(), `certidoes_prop_${scope.proposal.id}_${Date.now()}.pdf`);
  try {
    await exportPdf(html, tempPath, "A4", null);
    const buffer = fs.readFileSync(tempPath);
    const key = `proposal-certidoes/${scope.proposal.id}/relatorio_${Date.now()}.pdf`;
    const url = await uploadBufferToStorage({ bucket: process.env.S3_BUCKET, key, body: buffer, contentType: "application/pdf" });
    const { attachment } = await persistProposalDocument({
      proposalId: scope.proposal.id,
      buffer,
      url,
      filename: `Relatorio_certidoes_${scope.proposal.id.slice(0, 6)}.pdf`,
      mime: "application/pdf",
      category: "relatorio_certidoes",
      source: "infosimples",
      status: "ready",
    });
    return NextResponse.json({
      attachmentId: attachment.id,
      fileUrl: `/api/proposals/${scope.proposal.id}/attachments/${attachment.id}/file`,
    });
  } catch (err) {
    console.error("[certidoes/report proposta] erro ao gerar PDF", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro ao gerar relatorio" }, { status: 500 });
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      /* já removido */
    }
  }
}
