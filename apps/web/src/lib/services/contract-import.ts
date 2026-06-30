import { prisma } from "@/lib/db/prisma";
import { isGoogleDocsFeatureEnabled } from "@/lib/google/client";
import {
  uploadFileAsGoogleDoc,
  type ImportableMime,
} from "@/lib/google/upload-file-as-gdoc";
import { exportDocAsHtml, exportDocAsPdf } from "@/lib/google/docs";
import { watchFile } from "@/lib/google/watch";
import { shareDocWithOrgMembers } from "@/lib/google/share-org";
import { extractCcvDataJson } from "@/lib/extraction/ccv-extractor";
import { extractLocacaoContractDataJson } from "@/lib/extraction/locacao-extractor";
import {
  deriveDealMetadata,
  deriveLocacaoDealMetadata,
} from "@/lib/contracts/derive-deal-metadata";
import {
  LOCACAO_COMERCIAL_SCHEMA_TYPE,
  LOCACAO_SCHEMA_TYPE,
} from "@/lib/forms/validation-locacao";

export interface ImportContractInput {
  dealId: string;
  formId: string;
  orgId: string;
  userId: string;
  buffer: Buffer;
  sourceMime: ImportableMime;
  /** Nome original do arquivo enviado (usado pra título do GDoc). */
  sourceName: string;
  /** Título manual passado pelo usuário no cadastro rápido (opcional). */
  manualTitle?: string | null;
  /**
   * Esteira do deal — troca extractor (CCV ↔ contrato de locação), derive de
   * título/valor e, em locação, faz upsert best-effort do LeaseContract.
   * Default "venda" (comportamento histórico).
   */
  kind?: "venda" | "locacao";
}

export interface ImportContractResult {
  contractId: string;
  googleDocId: string;
  googleDocUrl: string;
}

/**
 * Importa um contrato externo (PDF/DOCX) como um Contract no fluxo de cadastro
 * rápido. Pipeline:
 *
 *   1. Sobe o arquivo binário para o Drive convertendo pra Google Doc nativo
 *      (preserva fonts/margens/tabelas do documento original).
 *   2. Registra Drive watch pra que o ContractChangeLog seja populado quando
 *      o usuário editar o doc dentro do iframe.
 *   3. Extrai um snapshot HTML do GDoc recém-criado pra alimentar
 *      `Contract.htmlContent` (usado em fallback de export e em diffs).
 *   4. Best-effort: roda extração Gemini pra popular `SalesForm.dataJson`
 *      com vendedores/compradores/imóveis/pagamento. Falha não bloqueia.
 *   5. Cria Contract com `templateId: null` (sinaliza "contrato importado",
 *      sem fonte Handlebars). Versão 1, status rascunho, isLatest true.
 *   6. Atualiza Deal com título/valor derivados (se a extração trouxe dados).
 *
 * NÃO aplica DocumentStyle — preservar layout original do contrato externo.
 */
export async function importContractFromFile(
  input: ImportContractInput
): Promise<ImportContractResult> {
  if (!isGoogleDocsFeatureEnabled()) {
    throw new Error(
      "Google Docs editor está desabilitado. Ative USE_GOOGLE_DOCS_EDITOR=true para importar contratos."
    );
  }

  const docName = `Contrato importado — ${input.sourceName}`;

  // 1. Upload + conversão Drive → GDoc nativo
  const uploaded = await uploadFileAsGoogleDoc({
    buffer: input.buffer,
    sourceMime: input.sourceMime,
    name: docName,
    orgId: input.orgId,
  });

  // 1b. Compartilha com membros da org (writer). Sem isso, usuários não-owner
  // veem "Solicitar acesso" no iframe. Falha não bloqueia.
  try {
    await shareDocWithOrgMembers(uploaded.docId, input.orgId);
  } catch (shareErr) {
    console.error(
      "[contract-import] Falha ao compartilhar com org members:",
      shareErr
    );
  }

  // 2. Watch Drive (best-effort)
  let watchData: {
    googleWatchChannel?: string;
    googleWatchResource?: string;
    googleWatchExpires?: Date;
  } = {};
  const webhookBase = process.env.NEXTAUTH_URL || process.env.PUBLIC_APP_URL;
  const watchToken = process.env.GOOGLE_WATCH_TOKEN?.trim();
  if (webhookBase && watchToken) {
    try {
      const watch = await watchFile({
        fileId: uploaded.docId,
        webhookUrl: `${webhookBase.replace(/\/$/, "")}/api/webhooks/google-drive`,
        token: watchToken,
      });
      watchData = {
        googleWatchChannel: watch.channelId,
        googleWatchResource: watch.resourceId,
        googleWatchExpires: new Date(watch.expiration),
      };
    } catch (err) {
      console.error("[contract-import] Falha ao registrar watch Drive:", err);
    }
  }

  // 3. Snapshot HTML pra fallback / diff
  let htmlSnapshot = "";
  try {
    htmlSnapshot = await exportDocAsHtml(uploaded.docId);
  } catch (err) {
    console.error("[contract-import] Falha ao exportar HTML inicial:", err);
  }

  // 4. Extração Gemini (best-effort — falha vira {}). Locação usa o extractor
  //    próprio, que também detecta a finalidade (residencial/comercial).
  //
  //    DOCX → PDF antes de extrair: o Gemini suporta DOCX (inlineData) de forma
  //    irregular e costuma devolver {} silencioso. Como o doc já virou GDoc
  //    nativo acima, exportamos como PDF (drive.files.export) e extraímos do PDF.
  //    Falha de export cai pro buffer original (não pior que antes).
  const DOCX_MIME =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  let extractionBuffer = input.buffer;
  let extractionMime: ImportableMime = input.sourceMime;
  if (input.sourceMime === DOCX_MIME) {
    try {
      extractionBuffer = await exportDocAsPdf(uploaded.docId);
      extractionMime = "application/pdf";
    } catch (err) {
      console.error("[contract-import] export DOCX→PDF falhou, usando buffer original:", err);
    }
  }

  const kind = input.kind ?? "venda";
  let extracted: Record<string, unknown>;
  let locacaoSchemaType: string | null = null;
  if (kind === "locacao") {
    const result = await extractLocacaoContractDataJson(
      extractionBuffer,
      extractionMime,
      { orgId: input.orgId, userId: input.userId, contractId: null }
    );
    extracted = result.dataJson;
    locacaoSchemaType =
      result.finalidade === "comercial"
        ? LOCACAO_COMERCIAL_SCHEMA_TYPE
        : LOCACAO_SCHEMA_TYPE;
  } else {
    extracted = await extractCcvDataJson(extractionBuffer, extractionMime, {
      orgId: input.orgId,
      userId: input.userId,
      contractId: null,
    });
  }

  // 5. Atualiza SalesForm com dados extraídos (já criado pelo endpoint). Em
  //    locação a finalidade detectada corrige o schemaType do form.
  await prisma.salesForm.update({
    where: { id: input.formId },
    data: {
      dataJson: extracted as object,
      status: "vinculado",
      ...(locacaoSchemaType ? { schemaType: locacaoSchemaType } : {}),
    },
  });

  // 6. Cria Contract sem templateId
  const contract = await prisma.contract.create({
    data: {
      dealId: input.dealId,
      templateId: null,
      userId: input.userId,
      version: 1,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dataJson: extracted as any,
      htmlContent: htmlSnapshot,
      status: "rascunho",
      isLatest: true,
      googleDocId: uploaded.docId,
      googleDocUrl: uploaded.webViewLink,
      googleDocStatus: "draft",
      ...watchData,
    },
  });

  // 7. Atualiza Deal com título/valor derivados (mantém o que existir se
  //    extração veio vazia — fallbackTitle é o título atual do deal).
  const deal = await prisma.deal.findUniqueOrThrow({
    where: { id: input.dealId },
    select: { title: true, value: true },
  });
  const derive = kind === "locacao" ? deriveLocacaoDealMetadata : deriveDealMetadata;
  const { title: derivedTitle, value: derivedValue } = derive(extracted, {
    formTitle: input.manualTitle ?? null,
    fallbackTitle: deal.title,
  });
  await prisma.deal.update({
    where: { id: input.dealId },
    data: {
      title: derivedTitle,
      value: derivedValue ?? deal.value,
    },
  });

  // 8. Locação: upsert best-effort do LeaseContract a partir da extração —
  //    extração incompleta NÃO bloqueia o import (usuário completa depois e
  //    a aba Cobrança/wizard cria a administração).
  if (kind === "locacao") {
    try {
      const { createLeaseContractFromDataJson } = await import(
        "@/lib/locacao/create-lease-contract"
      );
      await createLeaseContractFromDataJson({
        orgId: input.orgId,
        deal: { id: input.dealId },
        dataJson: extracted,
        contractId: contract.id,
      });
    } catch (err) {
      console.error("[contract-import] Falha ao upsert LeaseContract:", err);
    }
  }

  return {
    contractId: contract.id,
    googleDocId: uploaded.docId,
    googleDocUrl: uploaded.webViewLink,
  };
}
