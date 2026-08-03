import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { loadScopedProposal, proposalFeatureGuard } from "@/lib/proposals/route-helpers";
import { persistProposalDocument } from "@/lib/proposals/attachments";
import { downloadBufferFromUrl, deleteFromStorage } from "@/lib/storage/s3";
import { extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024;
const MIME_SHAPE = /^[\w.+-]+\/[\w.+-]+$/;

const bodySchema = z.object({
  url: z.string().url().max(2048),
  filename: z.string().min(1).max(255),
  mime: z.string().min(1).max(255).regex(MIME_SHAPE, "mime inválido"),
  category: z.string().max(120).optional(),
});

/**
 * POST /api/proposals/:id/attachments/finalize
 *
 * Registra como ProposalAttachment um arquivo que o navegador já subiu DIRETO
 * pro Vercel Blob (via /blob-upload). Espelha
 * `api/deals/[dealId]/attachments/finalize`.
 *
 * Caso de uso que motivou a rota: o **Registro do Aceite** da ClickSign — o PDF
 * com as provas de identidade e as mensagens trocadas no WhatsApp. A ClickSign
 * gera esse documento mas só o entrega pela interface web; a API v3 não expõe
 * link de download. Então o corretor baixa lá e sobe aqui.
 *
 * Reusa PROPOSAL_SEND como permissão: quem pode enviar a proposta pra assinatura
 * é quem cuida da documentação dela.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadScopedProposal(req, params.id);
  if ("fail" in r) return r.fail;
  const { auth, eff, proposal } = r;

  if (!can(eff, PERMISSION.PROPOSAL_SEND)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const feat = await proposalFeatureGuard(auth.org.id, proposal.kind);
  if (feat) return feat;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Bad Request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { url, filename, mime, category } = parsed.data;

  // Validação de propriedade: só aceita URL do store Vercel Blob cujo pathname
  // pertence a ESTA proposta. Impede registrar URL externa arbitrária (que seria
  // depois servida como documento da proposta) ou roubar pra outra proposta.
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: "URL inválida" }, { status: 400 });
  }
  const isBlobHost = parsedUrl.hostname.endsWith(".blob.vercel-storage.com");
  // Ancorado no início (o handshake grava em `proposal-attachments/<id>/…`, que
  // vira o pathname da URL). `includes` aceitaria o segmento em qualquer
  // posição, o que é mais frouxo do que parece.
  const belongsToProposal = parsedUrl.pathname.startsWith(
    `/proposal-attachments/${params.id}/`
  );
  if (parsedUrl.protocol !== "https:" || !isBlobHost || !belongsToProposal) {
    return NextResponse.json(
      { error: "URL não pertence a esta proposta" },
      { status: 403 }
    );
  }

  // Baixa o buffer (server-side; sem limite de body) pra contentHash + dedupe.
  let buffer: Buffer;
  try {
    buffer = await downloadBufferFromUrl(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Falha ao ler o arquivo enviado: ${msg}` },
      { status: 502 }
    );
  }
  if (buffer.length === 0) {
    return NextResponse.json({ error: "Conteúdo vazio" }, { status: 400 });
  }
  if (buffer.length > MAX_BYTES) {
    // Defesa em profundidade — o handshake já cap'a, mas confirmamos.
    await deleteFromStorage(url);
    return NextResponse.json(
      { error: `Excede limite de ${MAX_BYTES / 1024 / 1024}MB` },
      { status: 413 }
    );
  }

  const { attachment, deduped } = await persistProposalDocument({
    proposalId: proposal.id,
    buffer,
    url,
    filename,
    mime,
    category: category ?? "documento",
    source: "manual",
    auditCtx: extractAuditContextFromRequest(
      req,
      auth.org.id,
      auth.actor.effectiveUserId
    ),
  });

  // Se já existia o mesmo conteúdo, o blob recém-subido é cópia redundante.
  if (deduped && attachment.url !== url) {
    await deleteFromStorage(url);
  }

  return NextResponse.json({
    ok: true,
    deduped,
    attachment: {
      id: attachment.id,
      filename: attachment.filename,
      url: attachment.url,
      category: attachment.category,
    },
  });
}
