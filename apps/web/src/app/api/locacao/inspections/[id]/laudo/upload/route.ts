import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError } from "@/lib/locacao/route-helpers";
import { downloadBufferFromUrl } from "@/lib/storage/s3";
import { sniffFileType } from "@/lib/security/file-signature";
import {
  INSPECTION_STATUSES,
  isInspectionContentEditable,
} from "@/lib/locacao/inspection-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024;

const bodySchema = z.object({
  url: z.string().url().max(2048),
  filename: z.string().min(1).max(255).optional(),
});

const EDITABLE_STATUSES = INSPECTION_STATUSES.filter(isInspectionContentEditable);

// POST /api/locacao/inspections/[id]/laudo/upload — registra um laudo de
// vistoria já feito fora do sistema. O PDF sobe DIRETO pro Vercel Blob via
// ../blob-upload (client `upload()`, contorna o limite de ~4.5MB de corpo de
// função); aqui validamos conteúdo e propriedade da URL e gravamos
// laudoPdfUrl + status="laudo_gerado" sem exigir ambientesJson — o que torna a
// vistoria elegível pro envelope conjunto com o contrato
// (collectInspectionExtraDocuments) e pro envio avulso.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await ensureLocacaoAccess(PERMISSION.INSPECTION_EXECUTE);
  if (isRouteError(ctx)) return ctx;
  const { id } = await params;

  const inspection = await prisma.inspection.findFirst({
    where: { id, orgId: ctx.orgId },
    select: { id: true, status: true },
  });
  if (!inspection) {
    return NextResponse.json({ error: "Vistoria não encontrada" }, { status: 404 });
  }
  if (!isInspectionContentEditable(inspection.status)) {
    return NextResponse.json(
      { error: `Laudo em "${inspection.status}" não pode ser substituído.` },
      { status: 422 }
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Envie a URL do PDF subido via blob-upload." },
      { status: 400 }
    );
  }
  const { url, filename } = parsed.data;

  // Validação de propriedade: só URL do store Vercel Blob cujo pathname
  // pertence a ESTA vistoria (prefixo travado no handshake). Impede registrar
  // URL externa arbitrária como laudo — que depois assinaria no ClickSign.
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: "URL inválida" }, { status: 400 });
  }
  const isBlobHost = parsedUrl.hostname.endsWith(".blob.vercel-storage.com");
  const belongsToInspection = parsedUrl.pathname.startsWith(
    `/inspections/${id}/laudo-externo/`
  );
  if (parsedUrl.protocol !== "https:" || !isBlobHost || !belongsToInspection) {
    return NextResponse.json(
      { error: "URL não pertence a esta vistoria" },
      { status: 403 }
    );
  }

  let body: Buffer;
  try {
    body = await downloadBufferFromUrl(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Falha ao ler o arquivo enviado: ${msg}` },
      { status: 502 }
    );
  }
  if (body.length === 0 || body.length > MAX_BYTES) {
    return NextResponse.json({ error: "PDF vazio ou acima de 20MB." }, { status: 413 });
  }
  if (sniffFileType(body) !== "pdf") {
    return NextResponse.json({ error: "Arquivo não é um PDF válido." }, { status: 415 });
  }

  // Update condicional (TOCTOU): se o envio pra assinatura ganhou a corrida e o
  // status já saiu do editável, NÃO regride nem troca o PDF sob um envelope
  // vivo. qrToken é zerado: o QR impresso num laudo gerado anterior não pode
  // continuar validando um documento que deixou de ser o laudo vigente.
  const { count } = await prisma.inspection.updateMany({
    where: { id, orgId: ctx.orgId, status: { in: [...EDITABLE_STATUSES] } },
    data: {
      laudoPdfUrl: url,
      laudoOrigem: "externo",
      status: "laudo_gerado",
      qrToken: null,
    },
  });
  if (count === 0) {
    return NextResponse.json(
      { error: "A vistoria mudou de status durante o upload — recarregue e tente de novo." },
      { status: 409 }
    );
  }

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "INSPECTION_LAUDO_UPLOADED",
      result: "SUCCESS",
      resource: id,
      resourceType: "Inspection",
      metadata: { bytes: body.length, filename: (filename ?? "").slice(0, 200) },
    }
  );

  return NextResponse.json({ laudoPdfUrl: url, status: "laudo_gerado" });
}
