import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
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
import { extractLocacaoContractDataJson } from "@/lib/extraction/locacao-extractor";
import { formPublicPath } from "@/lib/forms/form-url";
import { getPipelineByKind } from "@/lib/modules/resolve";
import { MODULE } from "@/lib/modules/catalog";
import {
  LOCACAO_COMERCIAL_SCHEMA_TYPE,
  LOCACAO_SCHEMA_TYPE,
} from "@/lib/forms/validation-locacao";
import { resolveRequiredPresetSnapshot } from "@/lib/forms/required-snapshot";
import type { ImportableMime } from "@/lib/google/upload-file-as-gdoc";

export const runtime = "nodejs";
export const maxDuration = 60;

// Espelho de /api/deals/new-from-proposal pra LOCAÇÃO: PDF-only pela mesma
// limitação (Gemini não parseia DOCX — retorna {} sem extrair).
const MAX_BYTES = 20 * 1024 * 1024;

function isPdf(buffer: Buffer): boolean {
  return (
    buffer.length >= 8 &&
    buffer.subarray(0, 7).toString("ascii").startsWith("%PDF-1.")
  );
}

/**
 * POST /api/locacao/deals/new-from-proposal  (multipart/form-data)
 *
 * Cadastro com proposta de LOCAÇÃO: corretor sobe uma proposta/minuta em PDF,
 * o sistema extrai locadores/locatários/imóvel/aluguel/garantia via Gemini e
 * cria SalesForm pré-preenchido + Deal kind="locacao" em "Formulário". O
 * client redireciona pra `/f/{token}?prefilled=1`.
 *
 * Body: file (PDF ≤20MB) · title? · finalidade? ("residencial"|"comercial" —
 * default da extração; o campo do form vence se a extração detectar diferente).
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
  const finalidadeInput =
    (formData.get("finalidade") as string | null) === "comercial"
      ? "comercial"
      : null;

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Campo 'file' é obrigatório" },
      { status: 400 }
    );
  }
  const mime = file.type as ImportableMime;
  if (mime !== "application/pdf") {
    const isDocx =
      file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const msg = isDocx
      ? "DOCX ainda não é suportado pela extração automática. Exporte como PDF e tente de novo."
      : `Mime ${file.type} não suportado. Envie PDF.`;
    return NextResponse.json({ error: msg }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Arquivo maior que 20MB (${file.size} bytes)` },
      { status: 413 }
    );
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!isPdf(buffer)) {
    return NextResponse.json(
      { error: "Arquivo não parece ser um PDF válido (header inválido)." },
      { status: 400 }
    );
  }

  // Idempotência server-side (mesmo contrato da rota de vendas): duplo clique
  // ou retry de rede não pode criar 2 deals + 2 forms.
  const idempotencyKey = req.headers.get("x-idempotency-key");
  const result = await withIdempotency({
    userId: ctx.userId,
    key: idempotencyKey,
    method: "POST",
    path: "/api/locacao/deals/new-from-proposal",
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
      // Proposta tem locatário identificado → nasce em "Em Aprovação" (análise
      // de crédito da ficha antes do form). Fallback "Formulário".
      const stage =
        pipeline.stages.find((s) => s.name === "Em Aprovação") ??
        pipeline.stages.find((s) => s.name === "Formulário") ??
        pipeline.stages[0];

      // 1. Extração best-effort — falha vira dataJson vazio.
      let extracted: Record<string, unknown> = {};
      let finalidade: "residencial" | "comercial" = finalidadeInput ?? "residencial";
      try {
        const result = await extractLocacaoContractDataJson(buffer, mime, {
          orgId: ctx.orgId,
          userId: ctx.userId,
        });
        extracted = result.dataJson;
        // Só a finalidade DETECTADA pelo Gemini vence a escolha do operador —
        // ausência de finalidade na extração não pode rebaixar "comercial" pro
        // default residencial.
        if (result.finalidadeDetected) {
          finalidade = result.finalidade;
        }
      } catch (err) {
        console.error("[locacao/new-from-proposal] extração falhou:", err);
      }
      const schemaType =
        finalidade === "comercial" ? LOCACAO_COMERCIAL_SCHEMA_TYPE : LOCACAO_SCHEMA_TYPE;

      // 2. SalesForm pré-preenchido + Deal kind=locacao
      const form = await prisma.salesForm.create({
        data: {
          orgId: ctx.orgId,
          title,
          schemaType,
          dataJson: extracted as Prisma.InputJsonValue,
          status: "rascunho",
          // Snapshot do preset de obrigatoriedade (required-snapshot.ts).
          requiredPreset: await resolveRequiredPresetSnapshot(ctx.orgId, schemaType),
        },
      });

      const dealsInStage = await prisma.deal.count({ where: { stageId: stage.id } });
      const deal = await prisma.deal.create({
        data: {
          pipelineId: pipeline.id,
          stageId: stage.id,
          userId: ctx.userId,
          formId: form.id,
          kind: "locacao",
          sourceChannel: DEAL_SOURCE_CHANNEL.UPLOAD_PROPOSTA,
          title: title || `Proposta de locação — ${file.name}`,
          position: dealsInStage,
        },
      });

      // 3. Proposta bruta como FormAttachment (visível na etapa 0 do form)
      const safeName = file.name.replace(/[^\w.\-]+/g, "_");
      const storageKey = `proposals/${ctx.orgId}/${form.id}/${Date.now()}-${safeName}`;
      try {
        const blobUrl = await uploadBufferToStorage({
          key: storageKey,
          body: buffer,
          contentType: mime,
        });
        await prisma.formAttachment.create({
          data: {
            formId: form.id,
            filename: file.name,
            mime,
            url: blobUrl,
            category: "proposta_original",
            status: "ready",
            extractedData: extracted as Prisma.InputJsonValue,
          },
        });
      } catch (err) {
        console.error("[locacao/new-from-proposal] Falha ao subir Blob:", err);
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

      audit(extractAuditContextFromRequest(req, ctx.orgId, ctx.userId), {
        action: "FORM_PREFILLED_FROM_PROPOSAL",
        result: "SUCCESS",
        resource: form.id,
        resourceType: "SalesForm",
        metadata: {
          dealId: deal.id,
          formToken: form.token,
          filename: file.name,
          mime,
          sizeBytes: file.size,
          schemaType,
          extractedTopKeys: Object.keys(extracted),
        },
      });

      return {
        status: 201,
        body: {
          dealId: deal.id,
          formToken: form.token,
          formUrl: formPublicPath(form.token, form.title),
          formId: form.id,
        },
      };
    },
  });

  return NextResponse.json(result.body, { status: result.status });
}
