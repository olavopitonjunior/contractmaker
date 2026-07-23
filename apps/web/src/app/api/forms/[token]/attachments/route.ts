import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/db/prisma";
import { resolveFormScope, formLockedResponse } from "@/lib/forms/resolve-form-scope";
import { formClosedResponse } from "@/lib/forms/form-gate";
import { signatureMatchesMime } from "@/lib/security/file-signature";
import { RateLimits } from "@/lib/security/ratelimit";
import {
  parseAssignment,
  assignmentAllowedForRole,
  esteiraFromSchemaType,
} from "@/lib/forms/assignment-scope";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * O cache de OCR é por conteúdo (SHA-256) e cruza deals/forms da MESMA org. O
 * `assignment` ({kind,index}) é POR REGISTRO/contexto (qual slot deste deal),
 * NÃO derivado do conteúdo — reusá-lo aplicaria o slot de um deal antigo no
 * atual (ex.: mesmo RG de um cliente recorrente em dois negócios). Remove antes
 * de copiar os campos extraídos pro anexo novo.
 */
function stripAssignment(ed: unknown): Prisma.InputJsonValue | undefined {
  if (!ed || typeof ed !== "object") return undefined;
  const { assignment: _drop, ...rest } = ed as Record<string, unknown>;
  return rest as Prisma.InputJsonValue;
}

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
];

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  // Aceita token principal OU subtoken de participante. Subtoken só enxerga
  // os próprios uploads — vendedor não vê documentos do comprador.
  const scope = await resolveFormScope(params.token);
  if (!scope) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }

  // Listagem expõe `extractedData` (CPF/RG/nome da mãe extraídos por OCR) — o
  // gate de form enviado vale aqui igual ao do dataJson.
  const closed = await formClosedResponse(scope);
  if (closed) return closed;

  const attachments = await prisma.formAttachment.findMany({
    where: {
      formId: scope.formId,
      ...(scope.participantId ? { participantId: scope.participantId } : {}),
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    attachments: attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      mime: a.mime,
      category: a.category,
      extractedData: a.extractedData,
      // Phase F.I-α/F.IV — expor estado OCR no GET (antes o cliente scrapava DOM)
      status: a.status,
      extractError: a.extractError,
      extractingStartedAt: a.extractingStartedAt,
      contentHash: a.contentHash,
      fileUrl: `/api/forms/${params.token}/attachments/${a.id}/file`,
      createdAt: a.createdAt,
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}

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
  const form = { id: scope.formId, orgId: scope.orgId };

  // Form público é anônimo — throttle por token pra conter abuso de custo.
  const rl = await RateLimits.formAttachmentPerToken(params.token);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Muitos uploads. Tente novamente em alguns minutos." },
      { status: 429 }
    );
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo ausente" }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Arquivo excede o limite de 10 MB" },
      { status: 400 }
    );
  }

  if (!ALLOWED_MIMES.includes(file.type)) {
    return NextResponse.json(
      { error: `Tipo de arquivo nao suportado: ${file.type}` },
      { status: 400 }
    );
  }

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN nao configurado — upload indisponivel" },
      { status: 503 }
    );
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const pathname = `form-attachments/${form.id}/${Date.now()}-${safeName}`;

  try {
    // Compute SHA-256 before upload so the extract route can skip Gemini when
    // the same content has already been OCRed in this org (see F5.3 cache).
    const buffer = Buffer.from(await file.arrayBuffer());

    // Magic bytes — o content-type do formData vem do cliente e é forjável.
    // Rejeita arquivo renomeado (ex.: executável com extensão .pdf).
    if (!signatureMatchesMime(buffer, file.type)) {
      return NextResponse.json(
        { error: "O conteúdo do arquivo não corresponde ao tipo informado." },
        { status: 400 }
      );
    }

    const contentHash = createHash("sha256").update(buffer).digest("hex");

    // Pre-warm cache: if any other attachment in this org already has OCR
    // results for the same content (SHA-256), copy them over NOW. This means
    // the subsequent extract/batch-extract call will hit the `extractedData`
    // fast-path and skip Gemini entirely — saving cost + latency for duplicate
    // uploads (e.g. the user re-submits the same RG). The blob still gets
    // uploaded so the file is visible to the user in the UI.
    const cached = await prisma.formAttachment.findFirst({
      where: {
        contentHash,
        extractedData: { not: Prisma.JsonNull },
        form: { orgId: form.orgId },
      },
      select: { category: true, extractedData: true },
      orderBy: { createdAt: "desc" },
    });

    const blob = await put(pathname, buffer, {
      access: "public",
      contentType: file.type,
      token: blobToken,
      addRandomSuffix: true,
    });

    // Status inicial — economia de tokens:
    //   "ready" se content-hash bateu (cache pre-warm resolveu imediato)
    //   "awaiting_user" caso contrário — fica parado até o usuário clicar
    //                    "Extrair com IA" no UI. Worker do cron NÃO pega
    //                    awaiting_user, só queued/extracting. Mudança feita
    //                    para que documentos visuais (foto da fachada,
    //                    contrato anterior só pra arquivar) não queimem
    //                    tokens Gemini.
    const initialStatus = cached ? "ready" : "awaiting_user";

    const attachment = await prisma.formAttachment.create({
      data: {
        formId: form.id,
        // Upload via subtoken carimba o dono — habilita o filtro por parte
        // no GET (vendedor não vê docs do comprador). Token principal = null.
        participantId: scope.participantId,
        filename: file.name,
        mime: file.type,
        url: blob.url,
        category: cached?.category ?? null,
        extractedData: cached ? stripAssignment(cached.extractedData) : undefined,
        contentHash,
        byteSize: buffer.byteLength,
        status: initialStatus,
      },
    });

    // NÃO dispara worker fire-and-forget. Extração agora é on-demand:
    // o usuário clica "Extrair com IA" no card e o cliente bate em
    // POST /attachments/[id]/extract. Cache hit (cached !== null) já tem
    // dados sem chamada Gemini.

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
      { status: 202 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[form attachment upload]", msg);
    return NextResponse.json(
      { error: `Falha no upload: ${msg}` },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id obrigatorio" }, { status: 400 });
  }

  const scope = await resolveFormScope(params.token);
  if (!scope) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }
  const locked = formLockedResponse(scope);
  if (locked) return locked;
  const closed = await formClosedResponse(scope);
  if (closed) return closed;

  const attachment = await prisma.formAttachment.findUnique({ where: { id } });
  if (!attachment || attachment.formId !== scope.formId) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }
  // Subtoken só mexe nos próprios anexos.
  if (scope.participantId && attachment.participantId !== scope.participantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  // Sanitiza o assignment: kind ∈ conjunto conhecido, index inteiro [0,MAX].
  // Descarta qualquer prop extra injetada. O assignment é auto-aplicado no lado
  // do admin (Fix 3), então precisa ser tratado como entrada não-confiável.
  const assignment = parseAssignment(body?.assignment);
  if (!assignment) {
    return NextResponse.json({ error: "assignment inválido" }, { status: 400 });
  }
  // Subtoken só pode atribuir dentro do próprio papel — senão a parte forjaria
  // um slot de outra parte (`{kind:"vendedor"}` num link de comprador) que o
  // auto-apply gravaria em dados alheios sem revisão. `filterAssignmentOptions`
  // no cliente é só UX; esta é a invariante de verdade.
  if (
    scope.participantId &&
    scope.role &&
    !assignmentAllowedForRole(
      assignment.kind,
      scope.role,
      esteiraFromSchemaType(scope.schemaType),
    )
  ) {
    return NextResponse.json(
      { error: "assignment fora do escopo do papel" },
      { status: 403 },
    );
  }

  const current = (attachment.extractedData as Record<string, unknown>) || {};
  const next = { ...current, assignment };

  const updated = await prisma.formAttachment.update({
    where: { id },
    data: { extractedData: next as object },
  });

  return NextResponse.json({
    id: updated.id,
    extractedData: updated.extractedData,
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id obrigatorio" }, { status: 400 });
  }

  const scope = await resolveFormScope(params.token);
  if (!scope) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }
  // O DELETE não tinha guard nenhum: quem tivesse o link apagava anexo de form
  // travado/enviado. Espelha POST/PATCH.
  const locked = formLockedResponse(scope);
  if (locked) return locked;
  const closed = await formClosedResponse(scope);
  if (closed) return closed;

  const attachment = await prisma.formAttachment.findUnique({
    where: { id },
  });
  if (!attachment || attachment.formId !== scope.formId) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }
  // Subtoken só exclui os próprios anexos.
  if (scope.participantId && attachment.participantId !== scope.participantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Deleta a ROW primeiro; só remove o blob se ninguém mais o referenciar. O
  // finalize copia FormAttachment.url pro DealAttachment.url (mesmo objeto, sem
  // re-upload) — apagar o blob aqui incondicionalmente órfãva a matrícula/RG já
  // copiados pro deal. `deleteBlobIfUnreferenced` faz o ref-count antes.
  await prisma.formAttachment.delete({ where: { id } });

  const { deleteBlobIfUnreferenced } = await import(
    "@/lib/contracts/delete-cleanup"
  );
  await deleteBlobIfUnreferenced(prisma, attachment.url);

  return NextResponse.json({ ok: true });
}
