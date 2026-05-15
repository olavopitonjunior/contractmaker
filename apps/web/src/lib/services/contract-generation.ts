import { prisma } from "@/lib/db/prisma";
import { renderContratoHTML } from "@/lib/render/handlebars";
import { isGoogleDocsFeatureEnabled } from "@/lib/google/client";
import { uploadHtmlAsGoogleDoc } from "@/lib/google/upload-rendered-html";
import { copyContractGoogleDoc } from "@/lib/google/copy-doc";
import { shareDocWithOrgMembers } from "@/lib/google/share-org";
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
 * aren't captured in the wizard but are required by the contract
 * template (delivery deadlines, daily penalties, commission percentage, etc).
 *
 * 2026-05-16: pagamento.parcelas[] virou canônico com tipo/momento/meio.
 * Esta função:
 *   1. Soma parcelas por tipo → buckets nomeados (sinal_arras, fgts, ...)
 *      pra preservar templates atuais sem mudança.
 *   2. Filtra parcelas que já viram bucket (renderizadas hardcoded no
 *      template) pra não duplicar no loop {{#each parcelas}}.
 *   3. Deriva dias do momento (assinatura=0, escritura=prazo_escritura_dias,
 *      data_exata=delta, dias=mantém input).
 *   4. Deriva tipo_texto canônico quando o form não preencheu.
 */

const TIPO_TEXTO_CANONICO: Record<string, string> = {
  sinal_arras: "Sinal e princípio de pagamento (arras confirmatórias)",
  recursos_proprios: "Recursos próprios",
  fgts: "FGTS — Fundo de Garantia do Tempo de Serviço",
  cessao_consorcio: "Cessão de consórcio",
  financiamento: "Financiamento bancário com alienação fiduciária",
  permuta_veiculo: "Permuta com veículo",
  permuta_imovel: "Permuta com imóvel",
  outros: "Outras formas de pagamento",
};

// Mapeia tipo da parcela → nome do bucket no shape `pagamento.*`.
// `financiamento` → `alienacao_fiduciaria` por convenção dos templates v2.
// `permuta_*` e `outros` caem em `outras_formas`.
const TIPO_TO_BUCKET: Record<string, string> = {
  sinal_arras: "sinal_arras",
  recursos_proprios: "recursos_proprios",
  fgts: "fgts",
  cessao_consorcio: "cessao_consorcio",
  financiamento: "alienacao_fiduciaria",
  permuta_veiculo: "outras_formas",
  permuta_imovel: "outras_formas",
  outros: "outras_formas",
};

// Tipos renderizados HARDCODED na cláusula 2.1 do template a_vista — `a)`
// sempre é o sinal. Não pode aparecer duplicado dentro do loop {{#each}}.
const TIPOS_HARDCODED_AVISTA = new Set(["sinal_arras"]);

// Tipos renderizados HARDCODED no template financiamento:
// `a)` sinal, `b)` financiamento, `b.1)` fgts, `c)` recursos próprios.
// Tudo isso já sai pelo bucket nomeado — não repetir no loop.
const TIPOS_HARDCODED_FINANCIAMENTO = new Set([
  "sinal_arras",
  "financiamento",
  "fgts",
  "recursos_proprios",
]);

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

  // Pagamento — derivação canônica das parcelas tipadas.
  const pagamentoMut = enriched.pagamento as
    | (Record<string, unknown> & {
        parcelas?: Array<Record<string, unknown>>;
      })
    | undefined;

  if (pagamentoMut?.parcelas?.length) {
    // 1. Derivar dias e tipo_texto pra cada parcela quando faltam.
    const prazoEscritura = Number(config.prazo_escritura_dias || 60);
    const prazoTitulo = Number(
      config.prazo_titulo_dias || config.prazo_escritura_dias || 60
    );
    pagamentoMut.parcelas = pagamentoMut.parcelas.map((p) => {
      const out: Record<string, unknown> = { ...p };
      const momento = String(out.momento || "");
      // Derivar dias quando vazio/0 mas momento canônico setado.
      if ((!out.dias || Number(out.dias) === 0) && momento) {
        if (momento === "assinatura") out.dias = 0;
        else if (momento === "escritura") out.dias = prazoEscritura;
        else if (momento === "registro") out.dias = prazoTitulo;
        else if (momento === "data_exata" && typeof out.data_exata === "string") {
          const dt = new Date(out.data_exata);
          if (!Number.isNaN(dt.getTime())) {
            const delta = Math.max(
              0,
              Math.round((dt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
            );
            out.dias = delta;
          }
        }
      }
      // Derivar tipo_texto quando vazio mas tipo setado.
      if (
        (!out.tipo_texto || String(out.tipo_texto).trim() === "") &&
        typeof out.tipo === "string"
      ) {
        const tipoKey = String(out.tipo);
        if (tipoKey === "outros" && typeof out.tipo_outros_texto === "string") {
          out.tipo_texto = out.tipo_outros_texto;
        } else if (
          tipoKey.startsWith("permuta_") &&
          typeof out.permuta_descricao === "string"
        ) {
          const base = TIPO_TEXTO_CANONICO[tipoKey] ?? "Permuta";
          out.tipo_texto = out.permuta_descricao
            ? `${base}: ${out.permuta_descricao}`
            : base;
        } else {
          out.tipo_texto = TIPO_TEXTO_CANONICO[tipoKey] ?? "";
        }
      }
      return out;
    });

    // 2. Derivar buckets nomeados a partir de parcelas tipadas. Só
    // sobrescreve quando há ≥1 parcela com `tipo` setado (preserva forms
    // legados que editavam buckets direto sem tipar parcelas).
    const temParcelaTipada = pagamentoMut.parcelas.some(
      (p) => typeof p.tipo === "string"
    );
    if (temParcelaTipada) {
      const buckets: Record<string, number> = {
        sinal_arras: 0,
        recursos_proprios: 0,
        fgts: 0,
        cessao_consorcio: 0,
        alienacao_fiduciaria: 0,
        outras_formas: 0,
      };
      for (const p of pagamentoMut.parcelas) {
        const tipo = typeof p.tipo === "string" ? p.tipo : null;
        if (!tipo) continue;
        const bucket = TIPO_TO_BUCKET[tipo];
        if (bucket && buckets[bucket] !== undefined) {
          buckets[bucket] += Number(p.valor) || 0;
        }
      }
      for (const [k, v] of Object.entries(buckets)) {
        pagamentoMut[k] = v;
      }
    }

    // 3. Filtrar parcelas que já viram bucket renderizado HARDCODED no
    // template, pra evitar duplicação ("a) sinal_arras" + loop com outro
    // "sinal_arras"). Heurística da modalidade segue mesma regra abaixo.
    const isFinanciamento =
      (Number(pagamentoMut.alienacao_fiduciaria) || 0) > 0 ||
      (Number(pagamentoMut.fgts) || 0) > 0 ||
      (Number(pagamentoMut.cessao_consorcio) || 0) > 0;
    const hardcoded = isFinanciamento
      ? TIPOS_HARDCODED_FINANCIAMENTO
      : TIPOS_HARDCODED_AVISTA;
    pagamentoMut.parcelas = pagamentoMut.parcelas.filter((p) => {
      const tipo = typeof p.tipo === "string" ? p.tipo : null;
      // Sem tipo (forms legados ou CCV import) → mantém no loop pra não
      // sumir conteúdo de contratos antigos.
      if (!tipo) return true;
      return !hardcoded.has(tipo);
    });

    // 4. Letra do alfabeto (a_vista) e número sequencial (financiamento).
    pagamentoMut.parcelas = pagamentoMut.parcelas.map((p, i) => ({
      ...p,
      letra: indexToLetter(i + 1),
      numero: i + 1,
    }));
  }

  return enriched;
}

function indexToLetter(idx: number): string {
  if (idx < 0) return "";
  if (idx < 26) return String.fromCharCode(97 + idx);
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

      // Compartilha com membros da org (writer). Sem isso, usuários não-owner
      // veem "Solicitar acesso" no iframe — Drive autentica direto contra a
      // conta Google, fora da sessão NextAuth. Falha não bloqueia: helper
      // nunca lança e usa Promise.allSettled per-membro.
      try {
        await shareDocWithOrgMembers(created.docId, orgId);
      } catch (shareErr) {
        console.error(
          "[contract-generation] Falha ao compartilhar com org members:",
          shareErr
        );
      }

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
