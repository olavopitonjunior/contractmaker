import { prisma } from "@/lib/db/prisma";
import { applyProposalExtractions } from "./apply-extractions";
import { DEAL_SOURCE_CHANNEL } from "@/lib/pipeline/source-channel";
import { getPipelineByKind } from "@/lib/modules/resolve";
import { moduleForSchemaType } from "@/lib/modules/resolve";
import type { Prisma } from "@prisma/client";
import {
  deriveDealMetadata,
  deriveLocacaoDealMetadata,
} from "@/lib/contracts/derive-deal-metadata";
import { resolveManagerForCreate } from "@/lib/deals/manager";
import { resolveRequiredPresetSnapshot } from "@/lib/forms/required-snapshot";

export class ProposalConvertError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_completa"
      | "already_converted"
      | "no_pipeline"
      | "dossier_pending"
      // Feature Gerente: org exige gerente / id informado não é membro.
      | "gerente_obrigatorio"
      | "gerente_invalido"
  ) {
    super(message);
    this.name = "ProposalConvertError";
  }
}

/**
 * Converte uma proposta em negócio (Deal + SalesForm) no 1º stage do pipeline.
 *
 * É o payoff da feature: como o `dataJson` da proposta já está no shape do
 * SalesForm, a conversão NÃO traduz nada — é o "zero redigitação".
 *
 * À prova de corrida por dois mecanismos combinados:
 *  1. CAS `updateMany({ where:{ status:"completa", convertedDealId:null } })`
 *     dentro da transação — count===0 aborta com rollback;
 *  2. `Proposal.convertedDealId @unique` — a 2ª conversão concorrente colide.
 *
 * `allowUnsigned` permite converter sem assinatura (o corretor fechou no
 * telefone), com motivo obrigatório registrado pelo caller.
 */
export async function convertProposalToDeal(input: {
  proposalId: string;
  orgId: string;
  actorUserId: string;
  allowUnsigned?: boolean;
  unsignedReason?: string;
  /** Gerente responsável pelo negócio (feature Gerente). Sempre opcional — a
   *  obrigatoriedade é da org e vira `gerente_obrigatorio`. */
  managerUserId?: string | null;
}): Promise<{ dealId: string; formId: string }> {
  const proposal = await prisma.proposal.findUnique({
    where: { id: input.proposalId },
  });
  if (!proposal || proposal.orgId !== input.orgId) {
    throw new ProposalConvertError("Proposta não encontrada", "not_completa");
  }
  if (proposal.convertedDealId) {
    throw new ProposalConvertError("Proposta já convertida", "already_converted");
  }

  const signed = proposal.status === "completa";
  if (!signed && !input.allowUnsigned) {
    throw new ProposalConvertError(
      "Proposta ainda não foi assinada. Para converter mesmo assim, confirme com um motivo.",
      "not_completa"
    );
  }
  // Se assinada, o dossiê precisa estar pronto — senão os anexos (que nascem no
  // waitUntil de persistSignedPdf) ainda não existem e o Deal sairia sem eles.
  if (signed && !proposal.dossierUrl) {
    throw new ProposalConvertError(
      "O documento assinado ainda está sendo processado. Tente novamente em instantes — se demorar, o sistema refaz o processamento automaticamente e você também pode conferir o envelope na aba Assinaturas.",
      "dossier_pending"
    );
  }

  const dataJson = (proposal.dataJson ?? {}) as Record<string, unknown>;
  const moduleKind = moduleForSchemaType(proposal.schemaType);
  const pipeline = await getPipelineByKind(input.orgId, moduleKind, {
    include: { stages: { orderBy: { position: "asc" }, take: 1 } },
  });
  if (!pipeline || pipeline.stages.length === 0) {
    throw new ProposalConvertError(
      "Pipeline do módulo não encontrado.",
      "no_pipeline"
    );
  }
  const firstStage = pipeline.stages[0];

  // Normaliza o shape da proposta pro shape do FORM antes de copiar: a
  // proposta guarda o aluguel em `locacao.valor_aluguel`, mas o form/templates/
  // derive leem `aluguel.valor` (a página de proposta já escreve os dois; propostas
  // antigas só têm o primeiro). Normalizando NA CÓPIA,
  // todos os consumidores downstream (card, geração do contrato de locação,
  // cláusula de aluguel) enxergam o valor — não só este call-site.
  let normalizedData = dataJson;
  if (proposal.kind === "locacao") {
    const aluguel =
      (dataJson.aluguel as Record<string, unknown> | undefined) ?? {};
    const proposalAluguel = Number(
      (dataJson.locacao as { valor_aluguel?: unknown } | undefined)
        ?.valor_aluguel ?? 0
    );
    // Injeta quando aluguel.valor está ausente/vazio OU é zero explícito
    // (aluguel R$ 0 nunca é legítimo — trata como faltante). NÃO injeta sobre
    // valor não-numérico (ex.: "3.100,00" formatado por outro caminho): esse
    // é um valor real que a proposta não pode sobrescrever.
    const raw = aluguel.valor;
    const isAbsent =
      raw === undefined || raw === null || raw === "" || raw === 0 || raw === "0";
    if (isAbsent && proposalAluguel > 0) {
      normalizedData = {
        ...dataJson,
        aluguel: { ...aluguel, valor: proposalAluguel },
      };
    }
  }

  const attachments = await prisma.proposalAttachment.findMany({
    where: { proposalId: proposal.id },
  });

  // Documentos por parte (2026-09): o OCR feito NA PROPOSTA entra no dado do
  // negócio aqui, uma vez — só anexos prontos com atribuição humana, sem
  // sobrescrever campo já preenchido (e, na locação, mover para o fiador
  // define a garantia). Vem ANTES do `deriveMeta`: título e clientName do Deal
  // leem `locatarios[0].nome`/`compradores[0].nome`, e quando o único lugar
  // com o nome é o RG lido por OCR, derivar antes daria card "Locação para"
  // com o formulário já preenchido. O SalesForm e o Deal recebem o mesmo
  // `normalizedData`.
  const extractions = applyProposalExtractions(normalizedData, attachments, proposal.kind);
  normalizedData = extractions.merged;

  // Derive por kind — a variante de venda sobre dataJson de locação devolve
  // value/clientName null (lê compradores/pagamento; locação usa locatarios/
  // aluguel). Mesmo fix já aplicado no apply de anexos e no import.
  const deriveMeta =
    proposal.kind === "locacao" ? deriveLocacaoDealMetadata : deriveDealMetadata;
  const meta = deriveMeta(normalizedData, {
    formTitle: proposal.title,
    fallbackTitle: proposal.title,
  });

  // Gerente responsável resolvido FORA da transação — mesma validação dos
  // endpoints de criação (422 se a org exige, 400 se não é membro).
  const manager = await resolveManagerForCreate(input.orgId, input.managerUserId);
  if (!manager.ok) {
    throw new ProposalConvertError(
      manager.message,
      manager.error === "gerente_obrigatorio"
        ? "gerente_obrigatorio"
        : "gerente_invalido"
    );
  }

  // Snapshot do preset de obrigatoriedade (só locação grava — ver
  // lib/forms/required-snapshot.ts).
  const requiredPreset = await resolveRequiredPresetSnapshot(
    input.orgId,
    proposal.schemaType
  );

  const deal = await prisma.$transaction(async (tx) => {
    const form = await tx.salesForm.create({
      data: {
        orgId: input.orgId,
        title: meta.title,
        requiredPreset,
        // schemaType herdado — SEM isto, locação convertida viraria form de
        // compra e venda (default do campo) e o contrato sairia errado.
        schemaType: proposal.schemaType,
        dataJson: normalizedData as Prisma.InputJsonValue,
        status: "completo",
        completedAt: new Date(),
      },
    });

    const d = await tx.deal.create({
      data: {
        pipelineId: pipeline.id,
        stageId: firstStage.id,
        // NOT NULL — sem sessão (Max via Bearer), é o dono da proposta.
        userId: proposal.userId,
        formId: form.id,
        managerUserId: manager.managerUserId,
        sourceChannel: DEAL_SOURCE_CHANNEL.PROPOSTA,
        title: meta.title,
        value: meta.value,
        clientName: meta.clientName,
        // default "venda"; sem isto toda locação viraria deal de venda.
        kind: proposal.kind,
        dataJson: normalizedData as Prisma.InputJsonValue,
        // Consentimento LGPD dado na proposta segue para o negócio (a chave
        // canônica `creditConsent` é lida pelas rotas de crédito do deal).
        ...(proposal.complianceJson && typeof proposal.complianceJson === "object"
          ? { complianceJson: proposal.complianceJson as Prisma.InputJsonValue }
          : {}),
        stageEnteredAt: new Date(),
      },
    });

    if (attachments.length > 0) {
      // O FORMULÁRIO do negócio também recebe os documentos (etapa de
      // documentos lê FormAttachment; a aba Documentos lê DealAttachment).
      // Mesmo blob, sem re-upload. `participantId: null` = upload do admin,
      // visível a todas as partes: na conversão ainda não existem
      // participantes (links por parte) para atribuir, e atribuir errado
      // vazaria documento entre partes. Status nunca vira `queued` — a OCR
      // continua on-demand ("Extrair com IA"), como no upload direto.
      await tx.formAttachment.createMany({
        data: attachments.map((a) => ({
          formId: form.id,
          participantId: null,
          filename: a.filename,
          mime: a.mime,
          url: a.url,
          category: a.category ?? "documento",
          contentHash: a.contentHash ?? undefined,
          byteSize: a.byteSize ?? undefined,
          extractedData: (a.extractedData ?? undefined) as Prisma.InputJsonValue | undefined,
          status: a.status === "ready" || a.status === "failed" ? a.status : "awaiting_user",
        })),
      });
      await tx.dealAttachment.createMany({
        data: attachments.map((a) => ({
          dealId: d.id,
          filename: a.filename,
          mime: a.mime,
          url: a.url, // mesmo blob — sem re-upload
          category: a.category ?? "documento",
          // Origem preservada: o que o LEAD subiu pela página pública fica
          // distinguível do que o corretor anexou.
          source: a.source === "public" ? "proposal_public" : "proposal",
          contentHash: a.contentHash ?? undefined,
          byteSize: a.byteSize ?? undefined,
          // OCR + assignment viajam verbatim (mesmo contrato do DealAttachment).
          extractedData: (a.extractedData ?? undefined) as Prisma.InputJsonValue | undefined,
        })),
        skipDuplicates: true,
      });
    }

    // Certidões emitidas NA PROPOSTA (2026-09) seguem para o negócio: os jobs
    // ganham `dealId` (mantendo `proposalId`) e o PDF copiado acima é casado
    // ao job pelo blob (`url`), porque `CertidaoJob.attachmentId` é FK de
    // DealAttachment. Sem isto a aba Certidões do negócio nasceria vazia e o
    // lock por alvo permitiria reemitir o que a proposta já pagou.
    const relinked = await tx.certidaoJob.updateMany({
      where: { proposalId: proposal.id },
      data: { dealId: d.id },
    });
    // Análise de crédito (Ficha Certa) idem: o request ganha `dealId` e o PDF
    // do laudo (ProposalAttachment) é casado ao DealAttachment copiado pela
    // url → `reportDealAttachmentId`. Sem isto o card do negócio nasceria
    // vazio e o laudo só existiria na proposta. Janela conhecida: `attachments`
    // foi lido antes da transação; um laudo que a Ficha Certa conclua ENTRE a
    // leitura e o commit fica sem par aqui (card sem PDF, sem erro) — o
    // request segue relinkado e o PDF continua na proposta de origem.
    const relinkedCredit = await tx.creditAnalysisRequest.updateMany({
      where: { proposalId: proposal.id },
      data: { dealId: d.id },
    });
    const withJob = relinked.count > 0 ? attachments.filter((a) => a.certidaoJobId) : [];
    const creditReports =
      relinkedCredit.count > 0
        ? await tx.creditAnalysisRequest.findMany({
            where: { dealId: d.id, reportProposalAttachmentId: { not: null } },
            select: { id: true, reportProposalAttachmentId: true },
          })
        : [];
    const attById = new Map(attachments.map((a) => [a.id, a]));
    const reportUrls = creditReports
      .map((r) => attById.get(r.reportProposalAttachmentId!)?.url)
      .filter((u): u is string => !!u);
    const urls = Array.from(new Set([...withJob.map((a) => a.url), ...reportUrls]));
    if (urls.length > 0) {
      const copied = await tx.dealAttachment.findMany({
        where: { dealId: d.id, url: { in: urls } },
        select: { id: true, url: true },
      });
      const byUrl = new Map(copied.map((c) => [c.url, c.id]));
      for (const a of withJob) {
        const attachmentId = byUrl.get(a.url);
        if (!attachmentId || !a.certidaoJobId) continue;
        await tx.certidaoJob.updateMany({
          where: { id: a.certidaoJobId, dealId: d.id },
          data: { attachmentId },
        });
      }
      for (const r of creditReports) {
        const url = attById.get(r.reportProposalAttachmentId!)?.url;
        const reportDealAttachmentId = url ? byUrl.get(url) : undefined;
        if (!reportDealAttachmentId) continue;
        await tx.creditAnalysisRequest.updateMany({
          where: { id: r.id, dealId: d.id },
          data: { reportDealAttachmentId },
        });
      }
    }

    // CAS: fecha o loop e garante conversão única.
    const upd = await tx.proposal.updateMany({
      where: { id: proposal.id, convertedDealId: null },
      data: {
        status: "convertida",
        convertedDealId: d.id,
        convertedAt: new Date(),
        convertedWithoutSignature: !signed,
      },
    });
    if (upd.count === 0) {
      throw new ProposalConvertError(
        "Proposta já convertida (corrida)",
        "already_converted"
      );
    }
    return d;
  });

  await prisma.proposalEvent
    .create({
      data: {
        proposalId: proposal.id,
        eventName: "converted",
        source: "system",
        payload: {
          dealId: deal.id,
          unsigned: !signed,
          reason: input.unsignedReason ?? null,
        },
      },
    })
    .catch(() => {});

  return { dealId: deal.id, formId: deal.formId! };
}
