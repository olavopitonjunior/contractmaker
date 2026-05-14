import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { withIdempotency } from "@/lib/api/idempotency";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";
import { uploadBufferToStorage } from "@/lib/storage/s3";
import { extractCcvDataJson } from "@/lib/extraction/ccv-extractor";
import type { ImportableMime } from "@/lib/google/upload-file-as-gdoc";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_MIMES: readonly ImportableMime[] = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const MAX_BYTES = 20 * 1024 * 1024;

function validateFileHeader(buffer: Buffer, mime: ImportableMime): boolean {
  if (buffer.length < 8) return false;
  if (mime === "application/pdf") {
    return buffer.subarray(0, 7).toString("ascii").startsWith("%PDF-1.");
  }
  return (
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  );
}

/**
 * POST /api/deals/new-from-proposal  (multipart/form-data)
 *
 * Terceiro caminho de criação de negócio: corretor sobe uma PROPOSTA já
 * preenchida (valores, parcelas, comissão) e o sistema extrai TODOS os
 * campos comerciais via Gemini, criando um SalesForm pré-preenchido em
 * vez de pular direto pro editor de contrato.
 *
 * Diferenças vs `/api/deals/import-contract`:
 *   - NÃO sobe pro Google Docs (não há contrato ainda)
 *   - NÃO cria Contract (templateId=null sempre seria)
 *   - Cria SalesForm com `dataJson` POPULADO pela extração
 *   - Cria Deal em "Formulário" (não "Confecção de Contrato")
 *   - FormAttachment (não DealAttachment) com `category="proposta_original"`
 *     pra usuário ver original na step 0 do form
 *   - Retorna `{ formToken, dealId }` pro client redirecionar pra
 *     `/f/${token}?prefilled=1`
 *
 * Body:
 *   - file: PDF ou DOCX, ≤ 20MB
 *   - title: string opcional
 */
export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, { scope: "deals:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "multipart/form-data inválido" },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  const title = ((formData.get("title") as string | null) || "").trim() || null;

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Campo 'file' é obrigatório" },
      { status: 400 },
    );
  }

  const mime = file.type as ImportableMime;
  if (!ALLOWED_MIMES.includes(mime)) {
    return NextResponse.json(
      { error: `Mime ${file.type} não suportado. Envie PDF ou DOCX.` },
      { status: 415 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Arquivo maior que 20MB (${file.size} bytes)` },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!validateFileHeader(buffer, mime)) {
    return NextResponse.json(
      {
        error: `Arquivo não parece ser um ${mime === "application/pdf" ? "PDF" : "DOCX"} válido (header inválido).`,
      },
      { status: 400 },
    );
  }

  const idempotencyKey = req.headers.get("x-idempotency-key");

  const result = await withIdempotency({
    userId: auth.actor.effectiveUserId,
    key: idempotencyKey,
    method: "POST",
    path: "/api/deals/new-from-proposal",
    handler: async (): Promise<{ status: number; body: unknown }> => {
      const pipeline = await prisma.pipeline.findFirst({
        where: { orgId: auth.org.id },
        include: { stages: { orderBy: { position: "asc" } } },
      });
      if (!pipeline || pipeline.stages.length === 0) {
        return { status: 400, body: { error: "Pipeline não configurado" } };
      }

      // Sempre começa em "Formulário" — o corretor ainda vai revisar antes
      // de o contrato existir. Cai pra primeira stage em pipelines exóticos.
      const stage =
        pipeline.stages.find((s) => s.name === "Formulário") ??
        pipeline.stages[0];

      // 1. Roda Gemini extractor sobre a proposta. Best-effort:
      // falha → dataJson vazio e usuário preenche manualmente. Continua
      // viável mesmo sem Gemini configurado.
      let extracted: Record<string, unknown> = {};
      try {
        extracted = await extractCcvDataJson(buffer, mime, {
          orgId: auth.org.id,
          userId: auth.actor.effectiveUserId,
        });
      } catch (err) {
        console.error("[new-from-proposal] extractCcvDataJson falhou:", err);
      }

      // 2. SalesForm com dataJson populado + Deal "Formulário"
      const form = await prisma.salesForm.create({
        data: {
          orgId: auth.org.id,
          title,
          schemaType: "compra_venda_v1",
          dataJson: extracted as Prisma.InputJsonValue,
          status: "rascunho",
        },
      });

      const dealsInStage = await prisma.deal.count({
        where: { stageId: stage.id },
      });
      const deal = await prisma.deal.create({
        data: {
          pipelineId: pipeline.id,
          stageId: stage.id,
          userId: auth.actor.effectiveUserId,
          formId: form.id,
          title: title || `Proposta — ${file.name}`,
          position: dealsInStage,
        },
      });

      // 3. Salva proposta bruta como FormAttachment pra revisão na step 0
      const safeName = file.name.replace(/[^\w.\-]+/g, "_");
      const storageKey = `proposals/${auth.org.id}/${form.id}/${Date.now()}-${safeName}`;
      let blobUrl: string;
      try {
        blobUrl = await uploadBufferToStorage({
          key: storageKey,
          body: buffer,
          contentType: mime,
        });
      } catch (err) {
        console.error("[new-from-proposal] Falha ao subir Blob:", err);
        return {
          status: 500,
          body: {
            error:
              "Falha ao salvar arquivo no storage. Verifique BLOB_READ_WRITE_TOKEN.",
            dealId: deal.id,
            formToken: form.token,
          },
        };
      }

      await prisma.formAttachment.create({
        data: {
          formId: form.id,
          filename: file.name,
          mime,
          url: blobUrl,
          category: "proposta_original",
          // Status "ready" — não vai pro worker de OCR; OCR já rodou
          // explicitamente acima via extractCcvDataJson. extractedData
          // recebe o resultado pra auditoria/re-extração futura.
          status: "ready",
          extractedData: extracted as Prisma.InputJsonValue,
        },
      });

      audit(
        extractAuditContextFromRequest(
          req,
          auth.org.id,
          auth.actor.effectiveUserId,
        ),
        {
          action: "FORM_PREFILLED_FROM_PROPOSAL",
          result: "SUCCESS",
          resource: form.id,
          resourceType: "SalesForm",
          metadata: mergeAuditMetadata(
            {
              dealId: deal.id,
              formToken: form.token,
              filename: file.name,
              mime,
              sizeBytes: file.size,
              extractedTopKeys: Object.keys(extracted),
            },
            auth.actor,
          ),
        },
      );

      return {
        status: 201,
        body: {
          dealId: deal.id,
          formToken: form.token,
          formId: form.id,
        },
      };
    },
  });

  return NextResponse.json(result.body, { status: result.status });
}
