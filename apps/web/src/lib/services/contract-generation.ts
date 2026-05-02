import { prisma } from "@/lib/db/prisma";
import { renderContratoHTML } from "@/lib/render/handlebars";
import { isGoogleDocsFeatureEnabled } from "@/lib/google/client";
import { createDocFromTemplate } from "@/lib/google/docs";
import { flattenForGoogleDoc } from "@/lib/google/placeholders";
import { watchFile } from "@/lib/google/watch";

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
function enrichContractData(
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

  return enriched;
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

  // Render HTML
  const htmlContent = renderContratoHTML(template.handlebarsSource, enrichedData);

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

  // Phase 1 da migração Google Docs: se a feature flag estiver ativa e o
  // template tiver doc-modelo nativo no Drive, cria uma cópia, substitui
  // placeholders e persiste o id no contrato. Falha aqui não impede a criação
  // (degrada para TipTap até validação completa).
  let googleDocUrl: string | undefined;
  if (isGoogleDocsFeatureEnabled() && template.googleTemplateDocId) {
    try {
      // Adiciona campo `contrato.numero` para placeholder no header (Item C).
      const dataWithContractMeta = {
        ...enrichedData,
        contrato: {
          ...((enrichedData as Record<string, unknown>).contrato as Record<string, unknown> | undefined ?? {}),
          numero: `${contract.id.slice(-8).toUpperCase()}-v${contract.version}`,
          id: contract.id,
          versao: contract.version,
        },
      };
      const replacements = flattenForGoogleDoc(dataWithContractMeta);
      const created = await createDocFromTemplate({
        templateDocId: template.googleTemplateDocId,
        name: `Contrato ${contract.id} — v${contract.version}`,
        replacements,
        dataForLoops: dataWithContractMeta,
      });

      // Registra watch do Drive para popular ContractChangeLog quando o doc
      // for editado dentro do iframe (item 7). Falha aqui não impede a criação.
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
  const compradorNome = (dataJson.compradores as Array<{ nome?: string }>)?.[0]?.nome;
  const vendedorNome = (dataJson.vendedores as Array<{ nome?: string }>)?.[0]?.nome;
  const imovel = (dataJson.imoveis as Array<{ rua?: string; numero?: string; cidade?: string }>)?.[0];
  const valorTotal = Number(pagamento?.valor_total || 0);

  // Prioridade: titulo personalizado do formulario > vendedor→comprador > outros fallbacks
  const formTitle = deal.form?.title?.trim();
  const derivedTitle =
    formTitle ||
    (compradorNome && vendedorNome
      ? `${vendedorNome} → ${compradorNome}`
      : compradorNome
      ? `Venda para ${compradorNome}`
      : imovel?.rua
      ? `Imóvel: ${imovel.rua}${imovel.numero ? `, ${imovel.numero}` : ""}`
      : deal.title);

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
      value: valorTotal > 0 ? valorTotal : deal.value,
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
