import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { DEAL_SOURCE_CHANNEL } from "@/lib/pipeline/source-channel";
import {
  ensureLocacaoAccess,
  isRouteError,
} from "@/lib/locacao/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { withIdempotency } from "@/lib/api/idempotency";
import { uploadBufferToStorage } from "@/lib/storage/s3";
import { importContractFromFile } from "@/lib/services/contract-import";
import { getPipelineByKind } from "@/lib/modules/resolve";
import { MODULE } from "@/lib/modules/catalog";
import { LOCACAO_SCHEMA_TYPE } from "@/lib/forms/validation-locacao";
import type { ImportableMime } from "@/lib/google/upload-file-as-gdoc";

export const runtime = "nodejs";
// 300s (Vercel Pro): import de PDFs grandes (Drive + Gemini) estourava o limite
// de 60s, deixando órfãos e gerando negócios duplicados em retries. Ver dedup
// por contentHash abaixo (mesma correção do /api/deals/import-contract).
export const maxDuration = 300;

// Espelho de /api/deals/import-contract pra LOCAÇÃO (cadastro rápido com
// upload do contrato pronto → Google Doc → editor).
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
 * POST /api/locacao/deals/import-contract  (multipart/form-data)
 *
 * Cadastro rápido de LOCAÇÃO com upload: corretor sobe o contrato de locação
 * pronto (PDF/DOCX), o sistema converte pra Google Doc, extrai os dados
 * (locadores/locatários/imóvel/aluguel/garantia + finalidade) e cria
 * SalesForm vinculado + Deal kind="locacao" + Contract templateId=null +
 * LeaseContract rascunho (best-effort). Client redireciona pro detalhe
 * `/locacao/deals/{dealId}` (aba Contrato embute o editor).
 *
 * Body: file (PDF/DOCX ≤20MB) · title? · targetStage? ("Em contrato"|"Assinado")
 */
export async function POST(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.LEASE_CREATE);
  if (isRouteError(ctx)) return ctx;

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

  const ALLOWED_TARGET_STAGES = ["Em contrato", "Assinado"] as const;
  type AllowedTargetStage = (typeof ALLOWED_TARGET_STAGES)[number];
  const rawTargetStage =
    (formData.get("targetStage") as string | null) || "Em contrato";
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
      { error: `Mime ${file.type} não suportado. Envie PDF ou DOCX.` },
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

  // Idempotência server-side (mesmo contrato da rota de vendas): duplo clique
  // ou retry de rede não pode criar 2 deals + 2 GDocs.
  const idempotencyKey = req.headers.get("x-idempotency-key");
  const result = await withIdempotency({
    userId: ctx.userId,
    key: idempotencyKey,
    method: "POST",
    path: "/api/locacao/deals/import-contract",
    handler: async (): Promise<{ status: number; body: unknown }> => {
      const pipeline = await getPipelineByKind(ctx.orgId, MODULE.LOCACAO, {
        include: { stages: { orderBy: { position: "asc" } } },
      });
      if (!pipeline || pipeline.stages.length === 0) {
        return {
          status: 400,
          body: {
            error:
              "Pipeline de locação não configurado. Rode seed-pipeline-locacao.ts --apply.",
          },
        };
      }
      const stage =
        pipeline.stages.find((s) => s.name === targetStageName) ??
        pipeline.stages.find((s) => s.name === "Em contrato") ??
        pipeline.stages[0];

      // Dedup por conteúdo (idem /api/deals/import-contract): retry do mesmo
      // arquivo não cria outro negócio — devolve o já importado ou reusa o órfão
      // de um import que estourou o timeout.
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
        deal = { id: prior.deal.id };
        form = prior.deal.form;
      } else {
        // 1. SalesForm vinculado + Deal kind=locacao. O schemaType definitivo
        //    (residencial/comercial) é corrigido pelo importContractFromFile com
        //    a finalidade detectada na extração.
        const createdForm = await prisma.salesForm.create({
          data: {
            orgId: ctx.orgId,
            title,
            schemaType: LOCACAO_SCHEMA_TYPE,
            dataJson: {},
            status: "vinculado",
          },
        });

        const dealsInStage = await prisma.deal.count({ where: { stageId: stage.id } });
        const createdDeal = await prisma.deal.create({
          data: {
            pipelineId: pipeline.id,
            stageId: stage.id,
            userId: ctx.userId,
            formId: createdForm.id,
            kind: "locacao",
            sourceChannel: DEAL_SOURCE_CHANNEL.IMPORT_CONTRATO,
            title: title || `Contrato de locação importado — ${file.name}`,
            position: dealsInStage,
          },
        });

        // 2. Arquivo bruto pra Blob + DealAttachment de referência
        const safeName = file.name.replace(/[^\w.\-]+/g, "_");
        const storageKey = `imports/${ctx.orgId}/${createdDeal.id}/${Date.now()}-${safeName}`;
        let blobUrl: string;
        try {
          blobUrl = await uploadBufferToStorage({
            key: storageKey,
            body: buffer,
            contentType: mime,
          });
        } catch (err) {
          console.error("[locacao/import-contract] Falha ao subir Blob:", err);
          return {
            status: 500,
            body: {
              error:
                "Falha ao salvar arquivo no storage. Verifique BLOB_READ_WRITE_TOKEN.",
            },
          };
        }
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

      // 3. Pipeline de import (Drive + extração locação + Contract + LeaseContract)
      let importResult;
      try {
        importResult = await importContractFromFile({
          dealId: deal.id,
          formId: form.id,
          orgId: ctx.orgId,
          userId: ctx.userId,
          buffer,
          sourceMime: mime,
          sourceName: file.name,
          manualTitle: title,
          kind: "locacao",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[locacao/import-contract] importContractFromFile falhou:", err);
        return {
          status: 502,
          body: {
            error: `Falha ao importar contrato para o Google Docs: ${msg}`,
            dealId: deal.id,
          },
        };
      }

      await audit(extractAuditContextFromRequest(req, ctx.orgId, ctx.userId), {
        action: "CONTRACT_IMPORT",
        result: "SUCCESS",
        resource: importResult.contractId,
        resourceType: "Contract",
        metadata: {
          dealId: deal.id,
          formId: form.id,
          kind: "locacao",
          googleDocId: importResult.googleDocId,
          filename: file.name,
          mime,
          sizeBytes: file.size,
          targetStage: targetStageName,
        },
      });

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
