/**
 * F4 iteração 2026-05-17 — Geração de aditamento contratual.
 *
 * Aditamento é Contract com `kind="addendum"` + `parentVersionId` apontando
 * pro CCV original assinado. Herda dataJson (mesmas partes) + templateId
 * (modalidade) + DocumentStyle (preset) do parent. Renderiza usando
 * `templates/aditamento_v2.hbs` como master (preferido), com fallback pra
 * modelo da KB se houver hit em `query_knowledge_base(category="model")`.
 *
 * Não envia automaticamente pra assinatura — só cria o Contract+GoogleDoc.
 * Usuário decide envio depois via aba Assinaturas (fluxo Envelope existente).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "@/lib/db/prisma";
import { renderContratoHTML } from "@/lib/render/handlebars";
import { getDealSigningState } from "@/lib/contracts/signing-state";

interface AddendumAlteracao {
  /** Numeração interna da alteração ("2.1", "2.2", etc — só pra exibição). */
  numero: string;
  /** Texto operativo da alteração — vem de `suggested_aditamento` do finding
   *  OU de texto refinado pelo Editor com descrição do usuário. */
  texto: string;
}

export interface GenerateAddendumInput {
  dealId: string;
  /** Motivação superveniente em texto livre — vai no CONSIDERANDO. */
  considerando: string;
  /** Resumo de 1 frase do objeto do aditamento (cláusula 1ª). */
  objetoResumo: string;
  /** Alterações operativas (cláusula 2ª). */
  alteracoes: AddendumAlteracao[];
  /** Citação de base legal (CC arts, leis especiais) — cláusula 3ª. */
  baseLegal: string;
  /** Intervenientes-anuentes opcionais. Vendedores+compradores são herdados
   *  do parent automaticamente. */
  intervenientes?: Array<{
    nome: string;
    papel: string; // "interveniente_anuente" | "sucessor" | "outro"
    cpf?: string;
    cnpj?: string;
    qualificacao?: string;
    email?: string;
  }>;
  /** Usuário que disparou — fica em Contract.userId. */
  userId: string;
}

export interface GenerateAddendumResult {
  addendumContractId: string;
  parentContractId: string;
  aditivoNumero: number;
  googleDocId: string | null;
  googleDocUrl: string | null;
}

/**
 * Cria aditamento como novo Contract com kind="addendum".
 *
 * Pré-condições:
 *   - Deal tem Envelope source=contract status=closed (checked via
 *     getDealSigningState). Throws se não.
 *   - Parent contract existe e tem dataJson válido.
 */
export async function generateAddendumForDeal(
  input: GenerateAddendumInput
): Promise<GenerateAddendumResult> {
  const signing = await getDealSigningState(input.dealId);
  if (!signing.hasSignedContract || !signing.originalContractId) {
    throw new Error(
      "generateAddendumForDeal: deal não tem contrato assinado (Envelope source=contract status=closed). Aditamento só faz sentido pós-assinatura."
    );
  }

  const parent = await prisma.contract.findUnique({
    where: { id: signing.originalContractId },
    select: {
      id: true,
      dealId: true,
      templateId: true,
      dataJson: true,
      createdAt: true,
      version: true,
    },
  });
  if (!parent) {
    throw new Error(`Parent contract ${signing.originalContractId} não encontrado`);
  }

  // Conta aditamentos anteriores pra numerar (1°, 2°, 3°...)
  const previousAddendaCount = await prisma.contract.count({
    where: { dealId: input.dealId, kind: "addendum" },
  });
  const aditivoNumero = previousAddendaCount + 1;

  const deal = await prisma.deal.findUnique({
    where: { id: input.dealId },
    include: { pipeline: { select: { orgId: true } } },
  });
  if (!deal?.pipeline?.orgId) {
    throw new Error(`Deal ${input.dealId} sem orgId — não pode gerar aditamento`);
  }
  const orgId = deal.pipeline.orgId;

  // Monta dataJson do aditamento = dataJson do parent + intervenientes + metadados
  const parentDataJson = (parent.dataJson as Record<string, unknown>) ?? {};
  const addendumData: Record<string, unknown> = {
    ...parentDataJson,
    aditivo_numero: `${aditivoNumero}º`,
    aditivo_data_extenso: formatDateExtenso(new Date()),
    parent_contract_numero: `${parent.id.slice(-8).toUpperCase()}-v${parent.version}`,
    parent_data_extenso: formatDateExtenso(parent.createdAt),
    considerando_motivacao: input.considerando,
    objeto_resumo: input.objetoResumo,
    alteracoes: input.alteracoes,
    base_legal: input.baseLegal,
    intervenientes: input.intervenientes ?? [],
    foro_cidade: extractForoCidade(parentDataJson),
    foro_uf: extractForoUf(parentDataJson),
    vias: 2 + (input.intervenientes?.length ?? 0),
    assinatura_cidade: extractForoCidade(parentDataJson),
    assinatura_data_extenso: formatDateExtenso(new Date()),
  };

  // Lê template de aditamento.
  // Caminho: monorepo root /templates/aditamento_v2.hbs
  const templatePath = resolve(process.cwd(), "..", "..", "templates", "aditamento_v2.hbs");
  let templateSource: string;
  try {
    templateSource = readFileSync(templatePath, "utf-8");
  } catch {
    // Fallback: tenta a partir de apps/web/templates (caso link simbólico)
    try {
      templateSource = readFileSync(
        resolve(process.cwd(), "templates", "aditamento_v2.hbs"),
        "utf-8"
      );
    } catch (err) {
      throw new Error(
        `Template aditamento_v2.hbs não encontrado em ${templatePath}: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  const html = renderContratoHTML(templateSource, addendumData);

  // Upload pra Google Docs (mesmo pipeline do CCV)
  let googleDocId: string | null = null;
  let googleDocUrl: string | null = null;
  try {
    const { uploadHtmlAsGoogleDoc } = await import("@/lib/google/upload-rendered-html");
    const uploaded = await uploadHtmlAsGoogleDoc({
      htmlContent: html,
      name: `Aditamento ${aditivoNumero}º - ${input.dealId.slice(-8)}`,
      orgId,
    });
    googleDocId = uploaded.docId;
    googleDocUrl = uploaded.webViewLink;

    // Aplica DocumentStyle default herdando o que o CCV usa.
    // Reusa `googleApplyStylePreset` de ai/google-tool-handlers. Mesmo
    // código, sem duplicação (a tool de IA foi aposentada; a função fica).
    try {
      const { googleApplyStylePreset } = await import("@/lib/ai/google-tool-handlers");
      const defaultStyle = await prisma.documentStyle.findFirst({
        where: { orgId, isDefault: true },
      });
      if (defaultStyle && googleDocId) {
        await googleApplyStylePreset(googleDocId, defaultStyle);
      }
    } catch (styleErr) {
      console.error("[addendum-generation] applyStylePreset falhou:", styleErr);
      // Não bloqueia — aditamento criado sem style preset é melhor que nenhum aditamento
    }
  } catch (err) {
    console.error("[addendum-generation] uploadHtmlAsGoogleDoc falhou:", err);
    // Não bloqueia — Contract é criado mesmo sem GoogleDoc (status=error)
  }

  // Cria Contract kind="addendum". O demote do addendum latest anterior roda
  // na mesma transação — a invariante isLatest é por (dealId, kind), então um
  // 2º aditamento sem o demote violaria o índice único parcial.
  const addendum = await prisma.$transaction(async (tx) => {
    const agg = await tx.contract.aggregate({
      where: { dealId: input.dealId, kind: "addendum" },
      _max: { version: true },
    });
    await tx.contract.updateMany({
      where: { dealId: input.dealId, kind: "addendum", isLatest: true },
      data: { isLatest: false },
    });
    return tx.contract.create({
      data: {
        dealId: input.dealId,
        templateId: parent.templateId,
        userId: input.userId,
        version: (agg._max.version ?? 0) + 1,
        dataJson: addendumData as never,
        htmlContent: html,
        status: "rascunho",
        isLatest: true,
        parentVersionId: parent.id,
        kind: "addendum",
        googleDocId,
        googleDocUrl,
        googleDocStatus: googleDocId ? "draft" : null,
      },
      select: { id: true },
    });
  });

  // Audit
  await prisma.contractChangeLog.create({
    data: {
      contractId: addendum.id,
      userId: input.userId,
      action: "ai_edit",
      summary: `Aditamento ${aditivoNumero}º criado (parent: ${parent.id})`,
      details: {
        kind: "addendum",
        parentContractId: parent.id,
        aditivoNumero,
        alteracoesCount: input.alteracoes.length,
        intervenientesCount: input.intervenientes?.length ?? 0,
      } as never,
      source: "ai",
    },
  });

  return {
    addendumContractId: addendum.id,
    parentContractId: parent.id,
    aditivoNumero,
    googleDocId,
    googleDocUrl,
  };
}

function formatDateExtenso(d: Date): string {
  const meses = [
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
  ];
  return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
}

function extractForoCidade(dataJson: Record<string, unknown>): string {
  const config = dataJson.config as Record<string, unknown> | undefined;
  return (config?.foro_cidade as string) ?? extractAssinaturaCidade(dataJson) ?? "São Paulo";
}

function extractForoUf(dataJson: Record<string, unknown>): string {
  const config = dataJson.config as Record<string, unknown> | undefined;
  return (config?.foro_uf as string) ?? "SP";
}

function extractAssinaturaCidade(dataJson: Record<string, unknown>): string | null {
  const assinatura = dataJson.assinatura as Record<string, unknown> | undefined;
  return (assinatura?.cidade as string) ?? null;
}
