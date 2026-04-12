import { prisma } from "@/lib/db/prisma";
import { renderContratoHTML } from "@/lib/render/handlebars";

interface GenerateResult {
  contractId: string;
  version: number;
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

  // Detect modalidade
  const pagamento = dataJson.pagamento as Record<string, unknown> | undefined;
  const modalidade =
    (dataJson.modalidade as string) ||
    (pagamento && Number(pagamento.alienacao_fiduciaria || 0) > 0
      ? "financiamento"
      : "a_vista");

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

  // Render HTML
  const htmlContent = renderContratoHTML(template.handlebarsSource, dataJson);

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

  // Create contract
  const contract = await prisma.contract.create({
    data: {
      dealId: deal.id,
      templateId: template.id,
      userId,
      version: existingCount + 1,
      dataJson: dataJson as any,
      htmlContent,
      status: "rascunho",
      isLatest: true,
    },
  });

  // Derive deal title and value from form data
  const compradorNome = (dataJson.compradores as Array<{ nome?: string }>)?.[0]?.nome;
  const vendedorNome = (dataJson.vendedores as Array<{ nome?: string }>)?.[0]?.nome;
  const imovel = (dataJson.imoveis as Array<{ rua?: string; numero?: string; cidade?: string }>)?.[0];
  const valorTotal = Number(pagamento?.valor_total || 0);

  const derivedTitle =
    compradorNome && vendedorNome
      ? `${vendedorNome} → ${compradorNome}`
      : compradorNome
      ? `Venda para ${compradorNome}`
      : imovel?.rua
      ? `Imóvel: ${imovel.rua}${imovel.numero ? `, ${imovel.numero}` : ""}`
      : deal.title;

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

  return { contractId: contract.id, version: contract.version };
}
