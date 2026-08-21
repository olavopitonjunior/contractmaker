/**
 * F4 iteração 2026-05-17 — Análise de certidões anexadas MANUALMENTE.
 *
 * Cenário: o usuário não usou o dispatch automático Infosimples — só
 * jogou os PDFs de certidão na aba Documentos como `DealAttachment`. O
 * sistema precisa reconhecer cada anexo como certidão, extrair os
 * campos (mesmas keys que o normalizer Infosimples gera) e alimentar
 * `crossCheckCertidoes` com um `CertidaoJobLite` sintético.
 *
 * Trigger: pós-upload de `DealAttachment` com `category` começando com
 * `certidao_` OU classificada pelo OCR como certidão.
 *
 * Modo de operação: fire-and-forget — chamador faz `void
 * analyzeManualCertidaoForDeal(dealId, attachmentId)`. Erros são logados,
 * nunca propagam.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { extractDocumentData } from "@/lib/ai/ocr";
import { crossCheckCertidoes, type CertidaoJobLite } from "@/lib/ai/crosscheck/certidoes";
import { dedupeKeyFor } from "@/lib/ai/quickChecks";

/**
 * Mapa OCR documentType → endpoint canônico (Infosimples-like) que o
 * `crossCheckCertidoes` reconhece via `endpoints.ts::ENDPOINTS`. Permite
 * que anexos manuais usem as mesmas regras de detecção (matricula_onus,
 * vendedor_fiscal_positiva, etc) sem duplicar lógica.
 */
const OCR_TO_ENDPOINT: Record<string, string> = {
  matricula: "registradores/matric-obter",
  certidao_civel: "tribunal/tjsp/obter-civel", // genérico cível — handler agrupa por category
  certidao_trabalhista: "tribunal/tst/cndt",
  certidao_fiscal: "receita-federal/pgfn",
  certidao_protesto: "cenprot-sp/protestos",
  certidao_iptu: "pref/sp/sao-paulo/iptu",
};

/**
 * Constrói um `resultData` no formato `NormalizedResult` esperado pelo
 * crosscheck, mapeando os campos do OCR pros campos canônicos.
 */
function buildResultDataFromOcr(
  documentType: string,
  fields: Record<string, unknown>
): Record<string, unknown> {
  // Mapeamento conservador: se OCR populou `situacao`/`tem_onus`/etc, usa
  // direto. Senão, infere da presença de `detalhes_acoes`/`valor_debito_total`.
  const base: Record<string, unknown> = {
    situacao: fields.situacao ?? null,
    validade: fields.validade_ate ?? null,
    emissao: fields.data_emissao ?? null,
    detalhes: fields.detalhes ?? fields.detalhes_acoes ?? fields.detalhes_debitos ?? null,
    consta_debito:
      fields.tem_acao_em_curso === true ||
      fields.tem_pendencia === true ||
      fields.tem_protesto === true ||
      (typeof fields.valor_debito_total === "number" && fields.valor_debito_total > 0)
        ? true
        : fields.situacao === "negativa"
        ? false
        : undefined,
    raw: fields,
  };

  // Matrícula tem campos especiais que o crosscheck lê em raw.tem_onus/etc.
  if (documentType === "matricula") {
    const onusList = (fields.onus_existentes as unknown[] | undefined) ?? [];
    const temOnus = Array.isArray(onusList) && onusList.length > 0;
    base.raw = {
      ...fields,
      tem_onus: temOnus,
      ha_penhora: temOnus && JSON.stringify(onusList).toLowerCase().includes("penhora"),
      ha_alienacao_fiduciaria:
        temOnus && JSON.stringify(onusList).toLowerCase().includes("alienação fiduciária"),
      ha_indisponibilidade:
        temOnus && JSON.stringify(onusList).toLowerCase().includes("indisponibil"),
      numero_matricula: fields.matricula_numero,
      cartorio: fields.cartorio,
    };
    base.situacao = temOnus ? "positiva" : "negativa";
    base.consta_debito = temOnus;
  }

  return base;
}

/**
 * Decide `targetKind`+`targetIndex` baseado em quem a certidão se refere.
 * OCR retorna `nome_consultado`/`cpf_cnpj_consultado` — match com
 * `dataJson.vendedores[].cpf`/`compradores[].cpf` resolve quem é.
 * Pra matrícula/IPTU, sempre `targetKind="imovel" targetIndex=0` (1 imóvel default).
 */
function resolveTarget(
  documentType: string,
  fields: Record<string, unknown>,
  dataJson: Record<string, unknown>
): { targetKind: "vendedor" | "comprador" | "imovel"; targetIndex: number } {
  if (documentType === "matricula" || documentType === "certidao_iptu") {
    return { targetKind: "imovel", targetIndex: 0 };
  }

  const cpfRaw = String(fields.cpf_cnpj_consultado ?? "");
  const cpfDigits = cpfRaw.replace(/\D/g, "");

  const matchInList = (list: unknown): number => {
    if (!Array.isArray(list)) return -1;
    return list.findIndex((p) => {
      if (!p || typeof p !== "object") return false;
      const obj = p as Record<string, unknown>;
      const cpf = String(obj.cpf ?? obj.cnpj ?? "").replace(/\D/g, "");
      return cpf.length > 0 && cpf === cpfDigits;
    });
  };

  const vendedorIdx = matchInList(dataJson.vendedores);
  if (vendedorIdx >= 0) return { targetKind: "vendedor", targetIndex: vendedorIdx };

  const compradorIdx = matchInList(dataJson.compradores);
  if (compradorIdx >= 0) return { targetKind: "comprador", targetIndex: compradorIdx };

  // Fallback: assume vendedor 0 (caso mais comum em certidões da parte vendedora)
  return { targetKind: "vendedor", targetIndex: 0 };
}

/**
 * Lê DealAttachment, roda OCR estruturado (categorias certidão), sintetiza
 * `CertidaoJobLite`, e chama crossCheckCertidoes pra gerar findings.
 * Persiste:
 *   - DealAttachment.extractedData com os campos extraídos
 *   - ContractComment por finding (mesmo dedupeKey de cross_check Infosimples
 *     — evita duplicação se Infosimples também emitiu certidão equivalente)
 *
 * Não cria CertidaoJob na DB — sintético fica apenas em memória.
 */
export async function analyzeManualCertidaoForDeal(
  dealId: string,
  attachmentId: string
): Promise<void> {
  const attachment = await prisma.dealAttachment.findUnique({
    where: { id: attachmentId },
    select: { id: true, dealId: true, category: true, url: true, mime: true, filename: true },
  });
  if (!attachment || attachment.dealId !== dealId) return;
  // Ver o comentário gêmeo em lib/deals/attachments.ts: `"matricula"` é a
  // categoria que os produtores realmente gravam; `"matricula_anexada"` fica
  // por retrocompatibilidade, caso exista linha antiga com ela.
  if (
    !attachment.category?.startsWith("certidao_") &&
    attachment.category !== "matricula" &&
    attachment.category !== "matricula_anexada"
  ) {
    return;
  }

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      pipeline: { select: { orgId: true } },
      contracts: {
        where: { status: "rascunho", isLatest: true, kind: "contract" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  const contract = deal?.contracts[0];
  if (!contract) return; // Sem contrato draft, não há onde criar comments
  const orgId = deal?.pipeline?.orgId ?? "";

  // OCR — categoria já vem do upload (user marcou) ou foi classificada na ingestão.
  let fields: Record<string, unknown> = {};
  let documentType = attachment.category;
  try {
    // Resolve documentType: "matricula_anexada" (legado) → "matricula";
    // "matricula" e "certidao_*" já são o tipo que o OCR espera.
    const ocrCategory =
      attachment.category === "matricula_anexada" ? "matricula" : attachment.category;

    // Baixa o arquivo e roda OCR. Em prod a URL é Vercel Blob HTTPS público.
    const resp = await fetch(attachment.url, { signal: AbortSignal.timeout(30_000) });
    if (!resp.ok) {
      console.error(
        `[analyzeManualCertidaoForDeal] fetch attachment falhou: ${resp.status} ${attachment.url}`
      );
      return;
    }
    const buffer = Buffer.from(await resp.arrayBuffer());
    const imageBase64 = buffer.toString("base64");
    const mime = attachment.mime || resp.headers.get("content-type") || "application/pdf";

    const result = await extractDocumentData(imageBase64, mime, ocrCategory, {
      orgId,
      contractId: contract.id,
    });
    fields = result.fields;
    documentType = result.documentType;
  } catch (err) {
    console.error("[analyzeManualCertidaoForDeal] OCR falhou:", err);
    return;
  }

  // Persiste OCR em DealAttachment.extractedData
  try {
    await prisma.dealAttachment.update({
      where: { id: attachmentId },
      data: { extractedData: fields as unknown as Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue },
    });
  } catch (err) {
    console.error("[analyzeManualCertidaoForDeal] update extractedData falhou:", err);
  }

  // Sintetiza CertidaoJobLite
  const endpoint = OCR_TO_ENDPOINT[documentType];
  if (!endpoint) return;
  const dataJson = contract.dataJson as Record<string, unknown>;
  const { targetKind, targetIndex } = resolveTarget(documentType, fields, dataJson);
  const resultData = buildResultDataFromOcr(documentType, fields);

  const syntheticJob: CertidaoJobLite = {
    id: `manual:${attachmentId}`,
    endpoint,
    label: `${attachment.filename ?? "Certidão"} (anexada)`,
    targetKind,
    targetIndex,
    status: "success",
    resultCode: 200,
    resultData: resultData as Prisma.JsonValue,
    errorMessage: null,
    finishedAt: new Date(),
    attachmentId,
  };

  // Lê CertidaoJobs reais (Infosimples) e mescla com o sintético — finding
  // que já foi gerado por Infosimples não duplica graças ao dedupeKey.
  const realJobs = await prisma.certidaoJob.findMany({
    where: { dealId },
    select: {
      id: true,
      endpoint: true,
      label: true,
      targetKind: true,
      targetIndex: true,
      status: true,
      resultCode: true,
      resultData: true,
      errorMessage: true,
      finishedAt: true,
      attachmentId: true,
    },
  });

  const { findings } = crossCheckCertidoes({
    contractDataJson: dataJson,
    jobs: [...realJobs, syntheticJob],
  });

  // Filtra apenas findings cujo `jobId` é o sintético — outros já foram
  // tratados pelo Infosimples flow.
  const newFindings = findings.filter((f) => f.jobId === syntheticJob.id);

  for (const finding of newFindings) {
    const anchorBase = `${finding.kind}:${finding.target ?? "n/a"}:manual:${attachmentId}`;
    const dedupeKey = dedupeKeyFor("ai", `crosscheck-manual:${finding.kind}`, anchorBase);
    try {
      await prisma.contractComment.upsert({
        where: { contractId_dedupeKey: { contractId: contract.id, dedupeKey } },
        create: {
          contractId: contract.id,
          userId: null,
          authorName: "Análise IA (cert. anexada)",
          authorType: "ai",
          text: buildCommentText(finding, attachment.filename ?? "anexo"),
          selectedText: anchorBase.slice(0, 240),
          anchorId: dedupeKey,
          severity: finding.severity,
          dedupeKey,
        },
        update: { updatedAt: new Date() },
      });
    } catch (err) {
      console.error("[analyzeManualCertidaoForDeal] upsert comment falhou:", err);
    }
  }

  await prisma.contractChangeLog.create({
    data: {
      contractId: contract.id,
      userId: null,
      action: "validation",
      summary: `Análise de certidão anexada manualmente: ${newFindings.length} novos achados`,
      details: {
        trigger: "manual_certidao_upload",
        attachmentId,
        documentType,
        findings: newFindings.length,
      } as object,
      source: "ai",
    },
  });
}

function buildCommentText(
  finding: import("@/lib/ai/crosscheck/certidoes").CrossCheckFinding,
  filename: string
): string {
  const parts: string[] = [`📄 Origem: ${filename} (anexo manual)`, "", finding.message];
  if (finding.suggested_aditamento) {
    parts.push(`\n**Sugestão de aditamento:**\n${finding.suggested_aditamento}`);
  }
  if (finding.clarification_paths && finding.clarification_paths.length > 0) {
    parts.push(`\n**Caminhos sugeridos antes de aditar:**`);
    for (const path of finding.clarification_paths) {
      parts.push(`- ${path}`);
    }
  }
  if (finding.manual_action?.url) {
    parts.push(`\n**Ação manual:** [${finding.manual_action.label}](${finding.manual_action.url})`);
  }
  return parts.join("\n");
}
