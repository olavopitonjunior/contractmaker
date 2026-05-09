import { NextRequest, NextResponse } from "next/server";
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
import { importContractFromFile } from "@/lib/services/contract-import";
import type { ImportableMime } from "@/lib/google/upload-file-as-gdoc";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_MIMES: readonly ImportableMime[] = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const MAX_BYTES = 20 * 1024 * 1024; // 20MB

/**
 * Valida o header binário pra evitar que alguém renomeie um arquivo arbitrário
 * com extensão .pdf/.docx e contorne o filtro mime do navegador.
 *   - PDF: bytes 0..6 == "%PDF-1."
 *   - DOCX (zip): bytes 0..3 == 0x50 0x4B 0x03 0x04 ("PK\3\4")
 */
function validateFileHeader(buffer: Buffer, mime: ImportableMime): boolean {
  if (buffer.length < 8) return false;
  if (mime === "application/pdf") {
    return buffer.subarray(0, 7).toString("ascii").startsWith("%PDF-1.");
  }
  // DOCX é um ZIP
  return (
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  );
}

/**
 * POST /api/deals/import-contract  (multipart/form-data)
 *
 * Body:
 *   - file: PDF ou DOCX, ≤ 20MB
 *   - title: string opcional (título do negócio)
 *
 * Pipeline:
 *   1. Cria SalesForm (status=vinculado, dataJson={}) e Deal na stage
 *      "Confecção de Contrato" (ou primeira stage).
 *   2. Sobe arquivo no Vercel Blob como referência permanente.
 *   3. Cria DealAttachment apontando pro Blob (category="contrato_original").
 *   4. Chama `importContractFromFile`: upload pro Drive, watch, snapshot HTML,
 *      extração Gemini, cria Contract com templateId=null.
 *
 * Retorna { dealId, contractId, googleDocUrl } pro client redirecionar
 * pra `/contracts/[id]`.
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
      { status: 400 }
    );
  }

  const file = formData.get("file");
  const title = ((formData.get("title") as string | null) || "").trim() || null;

  const ALLOWED_TARGET_STAGES = [
    "Confecção de Contrato",
    "Enviado para assinatura",
    "Contrato assinado",
  ] as const;
  type AllowedTargetStage = (typeof ALLOWED_TARGET_STAGES)[number];
  const rawTargetStage =
    (formData.get("targetStage") as string | null) || "Confecção de Contrato";
  if (!ALLOWED_TARGET_STAGES.includes(rawTargetStage as AllowedTargetStage)) {
    return NextResponse.json(
      {
        error: `targetStage inválido. Aceitos: ${ALLOWED_TARGET_STAGES.join(", ")}`,
      },
      { status: 400 }
    );
  }
  const targetStageName = rawTargetStage as AllowedTargetStage;

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Campo 'file' é obrigatório" },
      { status: 400 }
    );
  }

  const mime = file.type as ImportableMime;
  if (!ALLOWED_MIMES.includes(mime)) {
    return NextResponse.json(
      {
        error: `Mime ${file.type} não suportado. Envie PDF ou DOCX.`,
      },
      { status: 415 }
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Arquivo maior que 20MB (${file.size} bytes)` },
      { status: 413 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!validateFileHeader(buffer, mime)) {
    return NextResponse.json(
      {
        error: `Arquivo não parece ser um ${mime === "application/pdf" ? "PDF" : "DOCX"} válido (header inválido).`,
      },
      { status: 400 }
    );
  }

  const idempotencyKey = req.headers.get("x-idempotency-key");

  const result = await withIdempotency({
    userId: auth.actor.effectiveUserId,
    key: idempotencyKey,
    method: "POST",
    path: "/api/deals/import-contract",
    handler: async (): Promise<{ status: number; body: unknown }> => {
      const pipeline = await prisma.pipeline.findFirst({
        where: { orgId: auth.org.id },
        include: { stages: { orderBy: { position: "asc" } } },
      });
      if (!pipeline || pipeline.stages.length === 0) {
        return { status: 400, body: { error: "Pipeline não configurado" } };
      }

      const stage =
        pipeline.stages.find((s) => s.name === targetStageName) ??
        pipeline.stages.find((s) => s.name === "Confecção de Contrato") ??
        pipeline.stages[0];

      // 1. SalesForm + Deal
      const form = await prisma.salesForm.create({
        data: {
          orgId: auth.org.id,
          title,
          schemaType: "compra_venda_v1",
          dataJson: {},
          status: "vinculado",
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
          title: title || `Contrato importado — ${file.name}`,
          position: dealsInStage,
        },
      });

      // 2. Sobe arquivo bruto pra Blob
      const safeName = file.name.replace(/[^\w.\-]+/g, "_");
      const storageKey = `imports/${auth.org.id}/${deal.id}/${Date.now()}-${safeName}`;
      let blobUrl: string;
      try {
        blobUrl = await uploadBufferToStorage({
          key: storageKey,
          body: buffer,
          contentType: mime,
        });
      } catch (err) {
        console.error("[import-contract] Falha ao subir Blob:", err);
        return {
          status: 500,
          body: {
            error:
              "Falha ao salvar arquivo no storage. Verifique BLOB_READ_WRITE_TOKEN.",
          },
        };
      }

      // 3. DealAttachment como referência
      await prisma.dealAttachment.create({
        data: {
          dealId: deal.id,
          filename: file.name,
          mime,
          url: blobUrl,
          category: "contrato_original",
          source: "upload",
        },
      });

      // 4. Roda pipeline de import (Drive + extração + Contract)
      let importResult;
      try {
        importResult = await importContractFromFile({
          dealId: deal.id,
          formId: form.id,
          orgId: auth.org.id,
          userId: auth.actor.effectiveUserId,
          buffer,
          sourceMime: mime,
          sourceName: file.name,
          manualTitle: title,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[import-contract] importContractFromFile falhou:", err);
        return {
          status: 502,
          body: {
            error: `Falha ao importar contrato para o Google Docs: ${msg}`,
            dealId: deal.id,
          },
        };
      }

      await audit(
        extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId),
        {
          action: "CONTRACT_IMPORT",
          result: "SUCCESS",
          resource: importResult.contractId,
          resourceType: "Contract",
          metadata: mergeAuditMetadata(
            {
              dealId: deal.id,
              formId: form.id,
              googleDocId: importResult.googleDocId,
              filename: file.name,
              mime,
              sizeBytes: file.size,
              targetStage: targetStageName,
            },
            auth.actor
          ),
        }
      );

      return {
        status: 201,
        body: {
          dealId: deal.id,
          contractId: importResult.contractId,
          googleDocUrl: importResult.googleDocUrl,
        },
      };
    },
  });

  return NextResponse.json(result.body, { status: result.status });
}
