import { prisma } from "@/lib/db/prisma";
import { DEAL_SOURCE_CHANNEL } from "@/lib/pipeline/source-channel";
import { getPipelineByKind } from "@/lib/modules/resolve";
import { moduleForSchemaType } from "@/lib/modules/resolve";
import type { Prisma } from "@prisma/client";
import {
  deriveDealMetadata,
  deriveLocacaoDealMetadata,
} from "@/lib/contracts/derive-deal-metadata";

export class ProposalConvertError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_completa"
      | "already_converted"
      | "no_pipeline"
      | "dossier_pending"
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
      "O documento assinado ainda está sendo processado. Tente novamente em instantes.",
      "dossier_pending"
    );
  }

  const dataJson = (proposal.dataJson ?? {}) as Record<string, unknown>;
  const module = moduleForSchemaType(proposal.schemaType);
  const pipeline = await getPipelineByKind(input.orgId, module, {
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
  // proposta guarda o aluguel em `locacao.valor_aluguel` (NovaPropostaDialog),
  // mas o form/templates/derive leem `aluguel.valor`. Normalizando NA CÓPIA,
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
    // Injeta SÓ quando aluguel.valor está de fato ausente/vazio. `!Number(v)`
    // trataria um valor legítimo não-numérico (ex.: "3.100,00" formatado por
    // outro caminho) como faltante e o sobrescreveria com o valor da proposta.
    const hasValor =
      aluguel.valor !== undefined &&
      aluguel.valor !== null &&
      aluguel.valor !== "";
    if (!hasValor && proposalAluguel > 0) {
      normalizedData = {
        ...dataJson,
        aluguel: { ...aluguel, valor: proposalAluguel },
      };
    }
  }

  // Derive por kind — a variante de venda sobre dataJson de locação devolve
  // value/clientName null (lê compradores/pagamento; locação usa locatarios/
  // aluguel). Mesmo fix já aplicado no apply de anexos e no import.
  const deriveMeta =
    proposal.kind === "locacao" ? deriveLocacaoDealMetadata : deriveDealMetadata;
  const meta = deriveMeta(normalizedData, {
    formTitle: proposal.title,
    fallbackTitle: proposal.title,
  });

  const attachments = await prisma.proposalAttachment.findMany({
    where: { proposalId: proposal.id },
  });

  const deal = await prisma.$transaction(async (tx) => {
    const form = await tx.salesForm.create({
      data: {
        orgId: input.orgId,
        title: meta.title,
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
        sourceChannel: DEAL_SOURCE_CHANNEL.PROPOSTA,
        title: meta.title,
        value: meta.value,
        clientName: meta.clientName,
        // default "venda"; sem isto toda locação viraria deal de venda.
        kind: proposal.kind,
        dataJson: normalizedData as Prisma.InputJsonValue,
        stageEnteredAt: new Date(),
      },
    });

    if (attachments.length > 0) {
      await tx.dealAttachment.createMany({
        data: attachments.map((a) => ({
          dealId: d.id,
          filename: a.filename,
          mime: a.mime,
          url: a.url, // mesmo blob — sem re-upload
          category: a.category ?? "documento",
          source: "proposal",
          contentHash: a.contentHash ?? undefined,
          byteSize: a.byteSize ?? undefined,
        })),
        skipDuplicates: true,
      });
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
