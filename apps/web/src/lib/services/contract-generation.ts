import { prisma } from "@/lib/db/prisma";
import { renderContratoHTML } from "@/lib/render/handlebars";
import { isGoogleDocsFeatureEnabled } from "@/lib/google/client";
import { uploadHtmlAsGoogleDoc } from "@/lib/google/upload-rendered-html";
import { copyContractGoogleDoc } from "@/lib/google/copy-doc";
import {
  flattenForPlaceholders,
  replacePlaceholdersInDoc,
} from "@/lib/google/replace-placeholders";
import { watchFile } from "@/lib/google/watch";
import { deriveDealMetadata } from "@/lib/contracts/derive-deal-metadata";

interface GenerateResult {
  contractId: string;
  version: number;
  googleDocUrl?: string;
}

/**
 * Enriches form data with sensible defaults for template variables that
 * aren't captured in the 7-step wizard but are required by the contract
 * template (delivery deadlines, daily penalties, commission percentage, etc).
 */
export function enrichContractData(
  data: Record<string, unknown>
): Record<string, unknown> {
  const enriched = { ...data };
  const config = ((enriched.config as Record<string, unknown>) || {}) as Record<string, unknown>;
  const tituloDefinitivo = enriched.titulo_definitivo as { prazo_dias?: number } | undefined;
  const entregaPosse = enriched.entrega_posse as { momento?: string } | undefined;
  const pagamento = enriched.pagamento as { valor_total?: number } | undefined;
  const comissao = ((enriched.comissao as Record<string, unknown>) || {}) as Record<string, unknown>;

  // Prazo de posse: default ao prazo do titulo definitivo ou 30 dias
  if (config.prazo_posse_dias == null) {
    config.prazo_posse_dias = tituloDefinitivo?.prazo_dias || 30;
  }
  // Prazo de escritura: usa prazo do titulo definitivo ou 60 dias
  if (config.prazo_escritura_dias == null) {
    config.prazo_escritura_dias = tituloDefinitivo?.prazo_dias || 60;
  }
  // Multas diarias: valores default razoaveis
  if (config.multa_diaria_posse == null) config.multa_diaria_posse = 500;
  if (config.multa_diaria_escritura == null) config.multa_diaria_escritura = 300;

  enriched.config = config;

  // Percentual da comissao: calculado automaticamente
  const valorComissao = Number(comissao.valor || 0);
  const valorTotal = Number(pagamento?.valor_total || 0);
  if (valorTotal > 0 && valorComissao > 0 && comissao.percentual == null) {
    comissao.percentual = Number(((valorComissao / valorTotal) * 100).toFixed(2));
  }
  enriched.comissao = comissao;

  // Titulo/registro aquisitivo: o template usa config.* — mantemos undefined
  // quando nao informado para que o template renda a frase condicionalmente
  // em vez de mostrar parenteses vazios.
  if (enriched.titulo_aquisitivo && !config.titulo_aquisitivo) {
    config.titulo_aquisitivo = enriched.titulo_aquisitivo;
  }
  if (enriched.registro_aquisitivo && !config.registro_aquisitivo) {
    config.registro_aquisitivo = enriched.registro_aquisitivo;
  }

  // Momento de posse texto
  if (entregaPosse && !entregaPosse.momento) {
    entregaPosse.momento = "assinatura";
  }

  // Parcelas: letra do alfabeto a partir de 'b' (sinal sempre 'a').
  // Handlebars não tem helper de índice→letra, então fazemos no enrich.
  const pagamentoMut = enriched.pagamento as
    | { parcelas?: Array<Record<string, unknown>> }
    | undefined;
  if (pagamentoMut?.parcelas?.length) {
    pagamentoMut.parcelas = pagamentoMut.parcelas.map((p, i) => ({
      ...p,
      letra: indexToLetter(i + 1), // 0 → 'b', 1 → 'c', ... (template à vista)
      numero: i + 1, // 1, 2, 3 ... (template financiamento)
    }));
  }

  return enriched;
}

function indexToLetter(idx: number): string {
  if (idx < 0) return "";
  if (idx < 26) return String.fromCharCode(97 + idx);
  // overflow improvável em parcelas reais, mas evita "undefined"
  return `${idx + 1}`;
}

/**
 * Generates a contract for a deal:
 * 1. Auto-detects modalidade from deal/form data
 * 2. Selects matching template
 * 3. Renders HTML with Handlebars
 * 4. Creates Contract v1 (or next version)
 * 5. Moves deal to "Confeccao de Contrato" stage
 */
export async function generateContractForDeal(
  dealId: string,
  userId: string,
  orgId: string
): Promise<GenerateResult> {
  const deal = await prisma.deal.findUniqueOrThrow({
    where: { id: dealId },
    include: { form: true },
  });

  // Get form data from deal or form
  const dataJson = deal.form
    ? (deal.form.dataJson as Record<string, unknown>)
    : (deal.dataJson as Record<string, unknown>) || {};

  // Detect modalidade. Heuristic wins over dataJson.modalidade because Zod's
  // .default("a_vista") always populates the field, even when the user never
  // touched the UI — so relying on dataJson.modalidade alone would pin every
  // contract as "a_vista". Any concrete payment flag signaling non-cash money
  // (financiamento bancario, FGTS, cessao de consorcio) overrides the default.
  const pagamento = dataJson.pagamento as Record<string, unknown> | undefined;
  const hasFinanciamento =
    !!pagamento &&
    (Number(pagamento.alienacao_fiduciaria || 0) > 0 ||
      Number(pagamento.fgts || 0) > 0 ||
      Number(pagamento.cessao_consorcio || 0) > 0);
  const modalidade: "financiamento" | "a_vista" = hasFinanciamento
    ? "financiamento"
    : (dataJson.modalidade as "financiamento" | "a_vista") || "a_vista";

  // Find template
  const template =
    (await prisma.contractTemplate.findFirst({
      where: { orgId, modalidade, isDefault: true, status: "active" },
    })) ||
    (await prisma.contractTemplate.findFirst({
      where: { orgId, isDefault: true, status: "active" },
    }));

  if (!template) {
    throw new Error("Nenhum template padrão encontrado para gerar o contrato.");
  }

  // Enrich data with template defaults (multas, prazos, percentual comissao)
  const enrichedData = enrichContractData(dataJson);

  // Render HTML — apenas pra engine="handlebars". Em engine="google_docs"
  // o conteúdo nunca passa por Handlebars; o doc fonte é copiado e tem seus
  // placeholders substituídos via Drive API. Ainda guardamos um snapshot
  // mínimo em htmlContent pra fallback de export/diff.
  const isGoogleDocsEngine = template.engine === "google_docs";
  const htmlContent = isGoogleDocsEngine
    ? `<p>Contrato gerado a partir de Google Doc (${template.name}).</p>`
    : renderContratoHTML(template.handlebarsSource, enrichedData);

  // Handle versioning
  const existingCount = await prisma.contract.count({
    where: { dealId: deal.id },
  });

  if (existingCount > 0) {
    await prisma.contract.updateMany({
      where: { dealId: deal.id, isLatest: true },
      data: { isLatest: false },
    });
  }

  // Create contract (save enriched data so re-renders stay consistent)
  const contract = await prisma.contract.create({
    data: {
      dealId: deal.id,
      templateId: template.id,
      userId,
      version: existingCount + 1,
      dataJson: enrichedData as any,
      htmlContent,
      status: "rascunho",
      isLatest: true,
    },
  });

  // Google Docs nativo: gera o doc fazendo upload do HTML já renderizado pelo
  // Handlebars. Antes (até 2026-05-05) usávamos um template-modelo cacheado +
  // replaceAllText, mas o template era gerado por um migrador que colapsava
  // loops para 1 iteração e fixava conditionals — ou seja, perdia 2º vendedor,
  // 2ª testemunha, branch cônjuge, slots de cláusula etc. Agora cada contrato
  // sobe seu próprio HTML, preservando tudo. Falha aqui não impede a criação
  // (degrada para TipTap).
  let googleDocUrl: string | undefined;
  if (isGoogleDocsFeatureEnabled()) {
    try {
      const numeroContrato = `${contract.id.slice(-8).toUpperCase()}-v${contract.version}`;
      const docName = `Contrato ${contract.id} — v${contract.version}`;

      let created: { docId: string; webViewLink: string };

      if (isGoogleDocsEngine) {
        // engine="google_docs": copia o template-modelo e substitui placeholders
        // simples via batchUpdate(replaceAllText). Não suporta loops nem
        // conditionals — limitação anunciada na UI de import.
        if (!template.googleTemplateDocId) {
          throw new Error(
            "Template Google Docs sem googleTemplateDocId associado."
          );
        }
        const copy = await copyContractGoogleDoc({
          sourceDocId: template.googleTemplateDocId,
          name: docName,
        });
        created = { docId: copy.docId, webViewLink: copy.webViewLink };

        const flat = flattenForPlaceholders(enrichedData);
        flat["contrato_numero"] = numeroContrato;
        flat["contrato_id"] = contract.id;
        flat["contrato_versao"] = String(contract.version);
        try {
          await replacePlaceholdersInDoc({
            docId: copy.docId,
            replacements: flat,
          });
        } catch (replaceErr) {
          console.error(
            "[contract-generation] Falha em replaceAllText:",
            replaceErr
          );
        }
      } else {
        // Pré-injeta `{{contrato.numero}}` no HTML caso o template tenha esse
        // placeholder em algum cabeçalho/rodapé customizado. O htmlContent já
        // foi renderizado por Handlebars contra `enrichedData`, então só
        // sobram literais dessa forma se o template os deixou intencionalmente.
        const htmlForUpload = htmlContent
          .replace(/\{\{\s*contrato\.numero\s*\}\}/g, numeroContrato)
          .replace(/\{\{\s*contrato\.id\s*\}\}/g, contract.id)
          .replace(/\{\{\s*contrato\.versao\s*\}\}/g, String(contract.version));

        const uploaded = await uploadHtmlAsGoogleDoc({
          htmlContent: htmlForUpload,
          name: docName,
        });
        created = { docId: uploaded.docId, webViewLink: uploaded.webViewLink };
      }

      // Registra watch do Drive para popular ContractChangeLog quando o doc
      // for editado dentro do iframe. Falha aqui não impede a criação.
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
            fileId: created.docId,
            webhookUrl: `${webhookBase.replace(/\/$/, "")}/api/webhooks/google-drive`,
            token: watchToken,
          });
          watchData = {
            googleWatchChannel: watch.channelId,
            googleWatchResource: watch.resourceId,
            googleWatchExpires: new Date(watch.expiration),
          };
        } catch (err) {
          console.error("[contract-generation] Falha ao registrar watch Drive:", err);
        }
      }

      await prisma.contract.update({
        where: { id: contract.id },
        data: {
          googleDocId: created.docId,
          googleDocUrl: created.webViewLink,
          googleDocStatus: "draft",
          ...watchData,
        },
      });
      googleDocUrl = created.webViewLink;

      // Aplica DocumentStyle default da org (fonte, tamanho, line-height,
      // margens) — Drive descarta CSS de classes ao importar HTML, então
      // sem isso o doc nasce com Arial 11pt + margens default. Falha não
      // bloqueia: doc fica funcional, só sem o branding visual.
      try {
        const defaultStyle = await prisma.documentStyle.findFirst({
          where: { orgId, isDefault: true },
        });
        if (defaultStyle) {
          const { googleApplyStylePreset } = await import("@/lib/ai/google-tool-handlers");
          await googleApplyStylePreset(created.docId, {
            fontFamily: defaultStyle.fontFamily,
            fontSizeBase: defaultStyle.fontSizeBase,
            lineHeight: defaultStyle.lineHeight,
            colorPrimary: defaultStyle.colorPrimary,
            marginTopMm: defaultStyle.marginTopMm,
            marginBottomMm: defaultStyle.marginBottomMm,
            marginLeftMm: defaultStyle.marginLeftMm,
            marginRightMm: defaultStyle.marginRightMm,
          });
        }
      } catch (styleErr) {
        console.error(
          "[contract-generation] Falha ao aplicar DocumentStyle default:",
          styleErr
        );
      }
    } catch (err) {
      // Persiste a causa exata da falha no contrato pra diagnóstico — sem
      // isso, o try/catch silencioso esconde o erro real (visto no QA E2E).
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      console.error("[contract-generation] Falha ao criar Google Doc:", err);
      try {
        await prisma.contract.update({
          where: { id: contract.id },
          data: { googleDocStatus: `error: ${msg.slice(0, 500)}` },
        });
      } catch {
        // ignora — diagnóstico best-effort
      }
    }
  }

  // Derive deal title and value from form data
  const { title: derivedTitle, value: derivedValue } = deriveDealMetadata(
    dataJson,
    { formTitle: deal.form?.title, fallbackTitle: deal.title }
  );

  // Move deal to "Confeccao de Contrato" stage and sync title/value
  const pipeline = await prisma.pipeline.findFirst({
    where: { orgId },
    include: { stages: { orderBy: { position: "asc" } } },
  });

  const confeccaoStage = pipeline?.stages.find(
    (s) => s.name === "Confecção de Contrato"
  );

  await prisma.deal.update({
    where: { id: deal.id },
    data: {
      title: derivedTitle,
      value: derivedValue ?? deal.value,
      ...(confeccaoStage ? { stageId: confeccaoStage.id } : {}),
    },
  });

  // Transfer form attachments to deal
  if (deal.formId) {
    const formAttachments = await prisma.formAttachment.findMany({
      where: { formId: deal.formId },
    });

    if (formAttachments.length > 0) {
      await prisma.dealAttachment.createMany({
        data: formAttachments.map((att) => ({
          dealId: deal.id,
          filename: att.filename,
          mime: att.mime,
          url: att.url,
          category: att.category || "documento",
        })),
      });
    }
  }

  return { contractId: contract.id, version: contract.version, googleDocUrl };
}
