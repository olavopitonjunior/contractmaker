import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/db/prisma";
import { resolveFormScope, formLockedResponse } from "@/lib/forms/resolve-form-scope";
import { resolveParticipantScope } from "@/lib/forms/participant-scope";
import { formClosedResponse, viewerIsOrgMember } from "@/lib/forms/form-gate";
import { audit } from "@/lib/security/audit";
import { archiveAttachment } from "@/lib/attachments/archive";
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

/** Um valor de campo corrigido à mão nunca precisa ser maior que isto. */
const MAX_FIELD_LEN = 500;

/**
 * Correção humana dos campos que o OCR leu errado.
 *
 * O que chega aqui é entrada anônima (a rota é pública por token) e o resultado
 * alimenta `mapExtractedToForm` — então a edição é DELIBERADAMENTE fechada:
 *
 *  - só chaves que o OCR já produziu para este anexo (nada de campo novo, nada
 *    de sobrescrever `assignment`/`category`/`confidence`, que moram no mesmo
 *    objeto e têm significado próprio);
 *  - só string, com teto de comprimento;
 *  - string vazia apaga o campo (é como o usuário descarta uma leitura errada).
 *
 * Devolve `null` quando o corpo não é um objeto de strings — o caller responde
 * 400 em vez de gravar lixo.
 */
function sanitizeFieldEdits(
  atuais: unknown,
  edits: unknown
): Record<string, unknown> | null {
  if (!edits || typeof edits !== "object" || Array.isArray(edits)) return null;
  if (!atuais || typeof atuais !== "object" || Array.isArray(atuais)) return null;
  const base = { ...(atuais as Record<string, unknown>) };
  for (const [k, v] of Object.entries(edits as Record<string, unknown>)) {
    if (!(k in base)) continue;
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    if (trimmed.length > MAX_FIELD_LEN) return null;
    if (trimmed === "") delete base[k];
    else base[k] = trimmed;
  }
  return base;
}

// ⚠️ Teto REAL aqui é ~4.5MB, não 10: este POST recebe o arquivo pelo CORPO da
// função (`req.formData()`), e a Vercel corta o corpo de função serverless
// nesse tamanho — um PDF de 6MB morre com 413 opaco da plataforma antes de
// chegar nesta constante. Os anexos do NEGÓCIO já não têm esse problema:
// `attachments/blob-upload` emite token e o navegador sobe direto pro Blob.
//
// Migrar esta rota pro mesmo desenho é o que remove o limite de verdade, e não
// é trocar um número: o servidor deixa de ver os bytes, então
// `signatureMatchesMime` (magic bytes — o content-type do formData é forjável)
// precisa passar a rodar sobre o objeto já no storage. Enquanto isso não
// acontece, subir esta constante só troca um erro claro por um opaco.
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

    // Sem isto o upload no formulário não deixava rastro nenhum, e comparar
    // "o que entrou" com "o que está lá" — a pergunta que se faz quando alguém
    // diz que um documento sumiu — era impossível.
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
          formId: form.id,
          filename: file.name,
          byteSize: buffer.byteLength,
          byParticipant: scope.participantId ?? null,
          ocrCacheHit: !!cached,
        },
      }
    );

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
  const querFields = body?.fields !== undefined;
  const querAssignment = body?.assignment !== undefined;
  if (!querFields && !querAssignment) {
    return NextResponse.json(
      { error: "informe assignment e/ou fields" },
      { status: 400 }
    );
  }
  // Sanitiza o assignment: kind ∈ conjunto conhecido, index inteiro [0,MAX].
  // Descarta qualquer prop extra injetada. O assignment é auto-aplicado no lado
  // do admin (Fix 3), então precisa ser tratado como entrada não-confiável.
  const assignment = querAssignment ? parseAssignment(body.assignment) : null;
  if (querAssignment && !assignment) {
    return NextResponse.json({ error: "assignment inválido" }, { status: 400 });
  }
  // Subtoken só pode atribuir dentro do próprio papel — senão a parte forjaria
  // um slot de outra parte (`{kind:"vendedor"}` num link de comprador) que o
  // auto-apply gravaria em dados alheios sem revisão. `filterAssignmentOptions`
  // no cliente é só UX; esta é a invariante de verdade.
  if (assignment && scope.participantId && scope.role) {
    // Escopo EFETIVO (config de visibilidade da org, não os defaults): uma
    // org que tirou uma etapa do link não pode seguir aceitando assignment
    // naquela seção só porque o default de código a incluía.
    const effective = await resolveParticipantScope(scope.role, scope.orgId);
    if (
      !assignmentAllowedForRole(
        assignment.kind,
        scope.role,
        esteiraFromSchemaType(scope.schemaType),
        effective.paths,
      )
    ) {
      return NextResponse.json(
        { error: "assignment fora do escopo do papel" },
        { status: 403 },
      );
    }
  }

  const current = (attachment.extractedData as Record<string, unknown>) || {};
  const next: Record<string, unknown> = { ...current };
  if (assignment) next.assignment = assignment;
  if (querFields) {
    const corrigidos = sanitizeFieldEdits(current.fields, body.fields);
    if (!corrigidos) {
      return NextResponse.json({ error: "fields inválido" }, { status: 400 });
    }
    next.fields = corrigidos;
  }

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

  // Só quem é da imobiliária exclui. Esta rota era ANÔNIMA: qualquer portador
  // do link `/f/[token]` — comprador, vendedor, quem recebeu encaminhado —
  // apagava documento de qualquer parte, e sem audit nenhum. Era o buraco que
  // tornava impossível responder "esse documento sumiu, quem apagou?".
  //
  // O subtoken segue podendo remover o que ELE mesmo enviou: é correção do
  // próprio upload, não exclusão de documento alheio.
  const viewerIsMember = await viewerIsOrgMember(scope.orgId);
  if (!viewerIsMember && !scope.participantId) {
    return NextResponse.json(
      {
        error:
          "Só a imobiliária pode remover documentos. Envie o arquivo correto — ela organiza depois.",
        reason: "member_only",
      },
      { status: 403 }
    );
  }

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

  // Arquiva e apaga na MESMA transação, e NÃO toca no blob. Antes chamávamos
  // `deleteBlobIfUnreferenced`, e quando nada mais referenciava a URL o objeto
  // ia embora — foi o que impediu recuperar o documento do caso que originou
  // esta mudança. `DeletedAttachment.url` entra em BLOB_REF_CHECKS, então nada
  // trata o objeto como órfão enquanto houver linha arquivada.
  const archivedId = await prisma.$transaction((tx) =>
    archiveAttachment(tx, {
      row: attachment,
      origin: "form",
      via: "ui_form",
      orgId: scope.orgId,
      userId: null,
      ipAddress: req.headers.get("x-forwarded-for") ?? null,
    })
  );

  await audit(
    {
      orgId: scope.orgId,
      userId: null,
      ipAddress: req.headers.get("x-forwarded-for") ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    },
    {
      action: "FORM_ATTACHMENT_DELETE",
      result: "SUCCESS",
      resource: attachment.id,
      resourceType: "FormAttachment",
      metadata: {
        formId: scope.formId,
        filename: attachment.filename,
        category: attachment.category,
        byParticipant: scope.participantId ?? null,
        archivedId,
        recoverable: true,
      },
    }
  );

  return NextResponse.json({ ok: true, archivedId, recoverable: true });
}
