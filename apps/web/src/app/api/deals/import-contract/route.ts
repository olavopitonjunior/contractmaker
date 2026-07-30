import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { DEAL_SOURCE_CHANNEL } from "@/lib/pipeline/source-channel";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { withIdempotency } from "@/lib/api/idempotency";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";
import { uploadBufferToStorage } from "@/lib/storage/s3";
import { getPipelineByKind } from "@/lib/modules/resolve";
import { MODULE } from "@/lib/modules/catalog";
import { importContractFromFile } from "@/lib/services/contract-import";
import { resolveManagerForCreate } from "@/lib/deals/manager";
import type { ImportableMime } from "@/lib/google/upload-file-as-gdoc";

export const runtime = "nodejs";
// 300s (Vercel Pro): a importação (upload Drive + conversão + Gemini) de PDFs
// grandes (~4MB escaneados) chegava a 59s e estourava o antigo limite de 60s,
// matando a função no meio — deixava Deal+SalesForm+anexo órfãos (sem Contract)
// e o operador re-subia o mesmo arquivo, gerando negócios duplicados. Ver dedup
// por contentHash abaixo, que reusa o órfão num retry em vez de criar outro.
export const maxDuration = 300;

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
  // Gerente responsável (feature Gerente) — mesmo padrão do targetStage: campo
  // opcional do multipart, string vazia = ausente.
  const managerUserId =
    ((formData.get("managerUserId") as string | null) || "").trim() || undefined;

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

  // Gerente resolvido antes da criação (fora da idempotência).
  const manager = await resolveManagerForCreate(auth.org.id, managerUserId);
  if (!manager.ok) {
    return NextResponse.json(
      { error: manager.error, message: manager.message },
      { status: manager.status }
    );
  }

  const idempotencyKey = req.headers.get("x-idempotency-key");

  const result = await withIdempotency({
    userId: auth.actor.effectiveUserId,
    key: idempotencyKey,
    method: "POST",
    path: "/api/deals/import-contract",
    handler: async (): Promise<{ status: number; body: unknown }> => {
      // SEMPRE por kind — org com pipeline de locação faria findFirst({orgId})
      // devolver o pipeline errado.
      const pipeline = await getPipelineByKind(auth.org.id, MODULE.VENDAS, {
        include: { stages: { orderBy: { position: "asc" } } },
      });
      if (!pipeline || pipeline.stages.length === 0) {
        return { status: 400, body: { error: "Pipeline não configurado" } };
      }

      const stage =
        pipeline.stages.find((s) => s.name === targetStageName) ??
        pipeline.stages.find((s) => s.name === "Confecção de Contrato") ??
        pipeline.stages[0];

      // Dedup por conteúdo: se o MESMO arquivo já foi enviado pra um deal deste
      // pipeline, não cria outro negócio. Cobre dois casos:
      //   (a) import anterior teve sucesso → retorna o deal existente (idempotente);
      //   (b) import anterior estourou o timeout e deixou um órfão (Deal/SalesForm
      //       sem Contract) → REUSA esse deal/form e só retenta a etapa pesada.
      // Foi exatamente o que gerou os 3 "Cód 19503 Igor Imene" duplicados.
      const contentHash = createHash("sha256").update(buffer).digest("hex");
      const prior = await prisma.dealAttachment.findFirst({
        where: {
          contentHash,
          category: "contrato_original",
          source: "upload",
          deal: { pipelineId: pipeline.id },
        },
        orderBy: { createdAt: "desc" },
        include: {
          deal: {
            include: {
              form: { select: { id: true, token: true } },
              contracts: {
                where: { isLatest: true, kind: "contract" },
                select: { id: true, googleDocUrl: true },
              },
            },
          },
        },
      });

      let deal: { id: string };
      let form: { id: string; token: string };

      if (prior?.deal?.form) {
        const priorContract = prior.deal.contracts[0];
        if (priorContract) {
          // (a) já importado com sucesso — devolve o mesmo deal.
          return {
            status: 200,
            body: {
              dealId: prior.deal.id,
              contractId: priorContract.id,
              googleDocUrl: priorContract.googleDocUrl,
              formToken: prior.deal.form.token,
              deduped: true,
            },
          };
        }
        // (b) órfão de import anterior — reusa deal+form e retenta o import.
        deal = { id: prior.deal.id };
        form = prior.deal.form;
      } else {
        // 1. SalesForm + Deal
        const createdForm = await prisma.salesForm.create({
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
        const createdDeal = await prisma.deal.create({
          data: {
            pipelineId: pipeline.id,
            stageId: stage.id,
            userId: auth.actor.effectiveUserId,
            formId: createdForm.id,
            managerUserId: manager.managerUserId,
            sourceChannel: DEAL_SOURCE_CHANNEL.IMPORT_CONTRATO,
            title: title || `Contrato importado — ${file.name}`,
            position: dealsInStage,
          },
        });

        // 2. Sobe arquivo bruto pra Blob
        const safeName = file.name.replace(/[^\w.\-]+/g, "_");
        const storageKey = `imports/${auth.org.id}/${createdDeal.id}/${Date.now()}-${safeName}`;
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

        // 3. DealAttachment como referência (com contentHash pra dedup futura)
        await prisma.dealAttachment.create({
          data: {
            dealId: createdDeal.id,
            filename: file.name,
            mime,
            url: blobUrl,
            category: "contrato_original",
            source: "upload",
            byteSize: buffer.byteLength,
            contentHash,
          },
        });

        deal = { id: createdDeal.id };
        form = { id: createdForm.id, token: createdForm.token };
      }

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
          // Token do form pra mandar o operador revisar/completar os dados
          // extraídos (campos faltantes destacados) antes de gerar/assinar.
          formToken: form.token,
        },
      };
    },
  });

  return NextResponse.json(result.body, { status: result.status });
}
