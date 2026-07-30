import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { resolveFormScope, formLockedResponse } from "@/lib/forms/resolve-form-scope";
import { formClosedResponse } from "@/lib/forms/form-gate";
import { signatureMatchesMime } from "@/lib/security/file-signature";
import { downloadBufferFromUrl, deleteFromStorage } from "@/lib/storage/s3";
import { audit } from "@/lib/security/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
];

const bodySchema = z.object({
  url: z.string().url().max(2048),
  filename: z.string().min(1).max(255),
  mime: z.string().min(1).max(255),
});

/**
 * Copiado de `../route.ts` — mesmo motivo: o `assignment` é por REGISTRO
 * (qual slot deste form), não derivado do conteúdo, então não pode viajar
 * junto no cache de OCR por SHA-256.
 */
function stripAssignment(ed: unknown): Prisma.InputJsonValue | undefined {
  if (!ed || typeof ed !== "object") return undefined;
  const { assignment: _drop, ...rest } = ed as Record<string, unknown>;
  return rest as Prisma.InputJsonValue;
}

/**
 * POST /api/forms/:token/attachments/finalize  (PÚBLICO, sem session)
 *
 * Registra como FormAttachment um arquivo que o navegador já subiu direto pro
 * Blob via `../blob-upload`. O corpo é só metadados, então não há teto de 4.5MB.
 *
 * ⚠️ É AQUI que mora a checagem que o upload direto poderia ter custado: o
 * servidor deixa de ver os bytes no caminho da requisição, então
 * `signatureMatchesMime` passa a rodar sobre o objeto BAIXADO do storage
 * (`downloadBufferFromUrl` — fetch server-side não tem limite de corpo). Se o
 * conteúdo não casa com o content-type declarado, o objeto é REMOVIDO do
 * storage e nada é criado: sem isso, um executável renomeado pra .pdf ficaria
 * hospedado em URL pública nossa, servido pelo proxy de anexos.
 *
 * Esta é a única remoção de blob que sobra no sistema, e ela é o inverso do que
 * o resto deste trabalho combate: aqui o arquivo NUNCA chegou a ser documento
 * de ninguém — é lixo de um upload rejeitado no mesmo request.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const scope = await resolveFormScope(params.token);
  if (!scope) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }
  const locked = formLockedResponse(scope);
  if (locked) return locked;
  const closed = await formClosedResponse(scope);
  if (closed) return closed;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { url, filename, mime } = parsed.data;

  if (!ALLOWED_MIMES.includes(mime)) {
    return NextResponse.json(
      { error: `Tipo de arquivo não suportado: ${mime}` },
      { status: 400 }
    );
  }

  // Propriedade da URL: só objeto do nosso store, sob o prefixo DESTE form.
  // Sem isto daria pra registrar URL externa arbitrária (o proxy de anexos
  // depois a serviria — SSRF/exfil) ou anexar um arquivo de outro formulário.
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: "URL inválida" }, { status: 400 });
  }
  const isBlobHost = parsedUrl.hostname.endsWith(".blob.vercel-storage.com");
  const inFormTree = parsedUrl.pathname.includes("form-attachments/");
  if (parsedUrl.protocol !== "https:" || !isBlobHost || !inFormTree) {
    return NextResponse.json(
      { error: "URL não pertence a um formulário" },
      { status: 403 }
    );
  }

  // Posse: o objeto tem que ser um upload NOVO, ainda não reivindicado. Sem
  // isto, quem tivesse o token deste formulário poderia anexar aqui o
  // documento de OUTRO formulário/negócio informando a URL dele — o prefixo
  // sozinho não prova nada, porque o cliente escolhe o pathname (ver
  // comentário no `/blob-upload`).
  const [claimedByForm, claimedByDeal] = await Promise.all([
    prisma.formAttachment.findFirst({ where: { url }, select: { id: true } }),
    prisma.dealAttachment.findFirst({ where: { url }, select: { id: true } }),
  ]);
  if (claimedByForm || claimedByDeal) {
    return NextResponse.json(
      { error: "Este arquivo já está anexado" },
      { status: 409 }
    );
  }

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
    await deleteFromStorage(url);
    return NextResponse.json({ error: "Conteúdo vazio" }, { status: 400 });
  }
  if (buffer.length > MAX_BYTES) {
    // Defesa em profundidade — o handshake já limita no próprio Blob.
    await deleteFromStorage(url);
    return NextResponse.json(
      { error: `Arquivo excede o limite de ${MAX_BYTES / 1024 / 1024} MB` },
      { status: 413 }
    );
  }

  // Magic bytes: o content-type é escolhido pelo cliente e é forjável.
  if (!signatureMatchesMime(buffer, mime)) {
    await deleteFromStorage(url);
    return NextResponse.json(
      { error: "O conteúdo do arquivo não corresponde ao tipo informado." },
      { status: 400 }
    );
  }

  const contentHash = createHash("sha256").update(buffer).digest("hex");

  // Pré-aquece o cache de OCR por conteúdo na MESMA org — igual ao POST
  // clássico: se esse conteúdo já foi extraído, o anexo nasce "ready" e não
  // queima tokens do Gemini.
  const cached = await prisma.formAttachment.findFirst({
    where: {
      contentHash,
      extractedData: { not: Prisma.JsonNull },
      form: { orgId: scope.orgId },
    },
    select: { category: true, extractedData: true },
    orderBy: { createdAt: "desc" },
  });

  const attachment = await prisma.formAttachment.create({
    data: {
      formId: scope.formId,
      participantId: scope.participantId,
      filename,
      mime,
      url,
      category: cached?.category ?? null,
      extractedData: cached ? stripAssignment(cached.extractedData) : undefined,
      contentHash,
      byteSize: buffer.byteLength,
      status: cached ? "ready" : "awaiting_user",
    },
  });

  await audit(
    {
      orgId: scope.orgId,
      userId: null,
      ipAddress: req.headers.get("x-forwarded-for") ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    },
    {
      action: "FORM_ATTACHMENT_UPLOAD",
      result: "SUCCESS",
      resource: attachment.id,
      resourceType: "FormAttachment",
      metadata: {
        formId: scope.formId,
        filename,
        byteSize: buffer.byteLength,
        byParticipant: scope.participantId ?? null,
        ocrCacheHit: !!cached,
        via: "client_direct",
      },
    }
  );

  // Shape IDÊNTICO ao do POST clássico — o card do DocumentosStep consome
  // `cached`/`extractedData`/`fileUrl` e quebraria em silêncio com outro
  // formato. Nota: `url` (do Blob) NÃO é exposta; o cliente usa sempre o proxy
  // `fileUrl`, que é o que o resto da UI espera.
  return NextResponse.json(
    {
      id: attachment.id,
      filename: attachment.filename,
      mime: attachment.mime,
      status: attachment.status,
      fileUrl: `/api/forms/${params.token}/attachments/${attachment.id}/file`,
      createdAt: attachment.createdAt,
      cached: cached !== null,
      category: cached?.category ?? null,
      extractedData: cached ? stripAssignment(cached.extractedData) ?? null : null,
    },
    { status: 201 }
  );
}
