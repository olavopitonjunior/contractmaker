import { prisma } from "@/lib/db/prisma";
import { uploadBufferToStorage } from "@/lib/storage/s3";
import { generateContractPdfBuffer } from "@/lib/render/contract-pdf";
import {
  activateEnvelope,
  addDocument,
  addRequirement,
  addSigner,
  cancelEnvelope,
  createEnvelope,
  deleteDraftEnvelope,
} from "./envelopes";
import { ClicksignError } from "./client";
import { dealDataToSigners } from "./mapping";
import {
  CLICKSIGN_COST_CENTS,
  envelopeCostCents,
  getMonthlyBudgetCents,
} from "./costs";
import type { AuthMethod } from "./types";

export class EnvelopeBudgetError extends Error {
  constructor(
    message: string,
    public readonly spentCents: number,
    public readonly budgetCents: number,
    public readonly planCostCents: number
  ) {
    super(message);
    this.name = "EnvelopeBudgetError";
  }
}

export class MissingEmailsError extends Error {
  constructor(
    public readonly missing: Array<{
      sourceKind: string;
      sourceIndex: number;
      name: string;
    }>
  ) {
    super(`${missing.length} parte(s) sem e-mail`);
    this.name = "MissingEmailsError";
  }
}

interface SendEnvelopeInput {
  contractId: string;
  authMethod?: AuthMethod;
  envelopeName?: string;
  deadlineAt?: Date | null;
}

export async function getMonthlySpendCents(orgId: string): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const result = await prisma.envelope.aggregate({
    where: {
      orgId,
      sentAt: { gte: start },
      status: { in: ["running", "closed"] },
    },
    _sum: { costCents: true },
  });
  return result._sum.costCents ?? 0;
}

/**
 * Executa o fluxo completo de envio. Faz rollback best-effort em caso de
 * falha parcial (deleta envelope draft na Clicksign + marca falha local).
 */
export async function sendEnvelopeForContract(input: SendEnvelopeInput) {
  const authMethod: AuthMethod = input.authMethod ?? "email";

  const contract = await prisma.contract.findUnique({
    where: { id: input.contractId },
    include: {
      deal: { include: { pipeline: { select: { orgId: true } } } },
    },
  });
  if (!contract) throw new Error("Contrato não encontrado");
  if (contract.status !== "aprovado") {
    throw new Error("Contrato precisa estar aprovado antes de enviar");
  }
  const orgId = contract.deal?.pipeline?.orgId;
  if (!orgId) throw new Error("Deal sem organização vinculada");

  const existingActive = await prisma.envelope.findFirst({
    where: {
      contractId: contract.id,
      status: { in: ["draft", "running", "closed"] },
    },
  });
  if (existingActive) {
    throw new Error(
      `Já existe um envelope ${existingActive.status} para este contrato (id ${existingActive.id})`
    );
  }

  const dataSource =
    (contract.dataJson as Record<string, unknown> | null) ?? null;
  const { signers, missing } = dealDataToSigners(dataSource, authMethod);
  if (missing.length > 0) throw new MissingEmailsError(missing);
  if (signers.length === 0) {
    throw new Error("Nenhum signatário válido encontrado nos dados do contrato");
  }

  const planCost = envelopeCostCents(signers.map(() => authMethod));
  const budget = getMonthlyBudgetCents();
  const spent = await getMonthlySpendCents(orgId);
  if (spent + planCost > budget) {
    throw new EnvelopeBudgetError(
      "Orçamento mensal Clicksign excedido",
      spent,
      budget,
      planCost
    );
  }

  // 1. Gera o PDF e faz upload imediato (snapshot imutável).
  const { buffer: pdfBuffer, filename } = await generateContractPdfBuffer(
    contract.id
  );
  let documentUrl: string | null = null;
  try {
    documentUrl = await uploadBufferToStorage({
      bucket: process.env.S3_BUCKET,
      key: `envelopes/${contract.id}/${Date.now()}-${filename}`,
      body: pdfBuffer,
      contentType: "application/pdf",
    });
  } catch (err) {
    console.error("[clicksign] falha ao fazer upload do snapshot:", err);
    // Continua sem persistir snapshot — não é bloqueante.
  }

  // 2. Cria a row local com status=draft.
  const envelope = await prisma.envelope.create({
    data: {
      contractId: contract.id,
      dealId: contract.dealId,
      orgId,
      name:
        input.envelopeName ||
        `Contrato ${contract.deal?.title || contract.id} (v${contract.version})`,
      status: "draft",
      authMethod,
      documentUrl,
      deadlineAt: input.deadlineAt ?? null,
      signers: {
        create: signers.map((s) => ({
          sourceKind: s.sourceKind,
          sourceIndex: s.sourceIndex,
          name: s.name,
          email: s.email,
          documentation: s.documentation,
          phone: s.phone,
          authMethod,
          status: "pending",
        })),
      },
    },
    include: { signers: true },
  });

  // 3. Chama Clicksign passo a passo. Em qualquer falha, marca envelope failed.
  let clicksignEnvelopeId: string | null = null;
  try {
    // a) Cria envelope na Clicksign
    const envResp = await createEnvelope({
      name: envelope.name,
      deadlineAt: envelope.deadlineAt ?? undefined,
    });
    clicksignEnvelopeId = pickResourceId(envResp);
    if (!clicksignEnvelopeId) throw new Error("Resposta sem id de envelope");

    // b) Adiciona o documento (PDF base64)
    const base64 = pdfBuffer.toString("base64");
    const docResp = await addDocument({
      envelopeId: clicksignEnvelopeId,
      filename,
      contentBase64: base64,
    });
    const documentClicksignId = pickResourceId(docResp);
    if (!documentClicksignId) throw new Error("Resposta sem id de documento");

    // c) Adiciona signers
    const signerIdMap = new Map<string, { signerId: string; reqIds: string[] }>();
    for (const localSigner of envelope.signers) {
      const signerResp = await addSigner({
        envelopeId: clicksignEnvelopeId,
        name: localSigner.name,
        email: localSigner.email,
        documentation: localSigner.documentation ?? undefined,
        phoneNumber: localSigner.phone ?? undefined,
        hasDocumentation: Boolean(localSigner.documentation),
        communicateBy: communicateByFor(authMethod),
      });
      const signerId = pickResourceId(signerResp);
      if (!signerId) throw new Error("Resposta sem id de signer");

      // d) Cria requirements (auth + sign) para o par signer/document
      const authReq = await addRequirement({
        envelopeId: clicksignEnvelopeId,
        documentClicksignId,
        signerClicksignId: signerId,
        action: "provide_evidence",
        auth: authMethod,
      });
      const signReq = await addRequirement({
        envelopeId: clicksignEnvelopeId,
        documentClicksignId,
        signerClicksignId: signerId,
        action: "qualify",
        role: "sign",
      });
      const reqIds = [
        pickResourceId(authReq),
        pickResourceId(signReq),
      ].filter(Boolean) as string[];
      signerIdMap.set(localSigner.id, { signerId, reqIds });
    }

    // Persiste ids da Clicksign nos signers locais
    await Promise.all(
      Array.from(signerIdMap.entries()).map(([localId, info]) =>
        prisma.envelopeSigner.update({
          where: { id: localId },
          data: { clicksignId: info.signerId, requirementIds: info.reqIds },
        })
      )
    );

    // e) Ativa envelope (status=running) — dispara notificações
    await activateEnvelope(clicksignEnvelopeId);

    const updated = await prisma.envelope.update({
      where: { id: envelope.id },
      data: {
        clicksignId: clicksignEnvelopeId,
        documentClicksignId,
        status: "running",
        sentAt: new Date(),
        costCents: planCost,
        signers: undefined,
      },
      include: { signers: true },
    });
    // Marca todos os signers como notified (a Clicksign confirma via webhook)
    await prisma.envelopeSigner.updateMany({
      where: { envelopeId: envelope.id, status: "pending" },
      data: { status: "notified", notifiedAt: new Date() },
    });

    return { ...updated, signers: await listSigners(envelope.id) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[clicksign] falha durante o envio:", msg);
    // Rollback best-effort: tenta deletar o envelope draft que ficou pendurado.
    if (clicksignEnvelopeId) {
      try {
        await deleteDraftEnvelope(clicksignEnvelopeId);
      } catch (cleanupErr) {
        console.error("[clicksign] falha ao limpar envelope draft:", cleanupErr);
      }
    }
    await prisma.envelope.update({
      where: { id: envelope.id },
      data: { status: "failed", lastError: msg.slice(0, 4000) },
    });
    throw err;
  }
}

export async function cancelEnvelopeFlow(envelopeId: string): Promise<void> {
  const envelope = await prisma.envelope.findUnique({
    where: { id: envelopeId },
  });
  if (!envelope) throw new Error("Envelope não encontrado");

  if (envelope.clicksignId) {
    try {
      if (envelope.status === "draft") {
        await deleteDraftEnvelope(envelope.clicksignId);
      } else if (envelope.status === "running") {
        await cancelEnvelope(envelope.clicksignId);
      }
    } catch (err) {
      // Se a Clicksign já tiver removido (404), ignoramos.
      if (!(err instanceof ClicksignError) || err.status !== 404) {
        throw err;
      }
    }
  }

  await prisma.envelope.update({
    where: { id: envelopeId },
    data: { status: "canceled", canceledAt: new Date() },
  });
  await prisma.envelopeSigner.updateMany({
    where: {
      envelopeId,
      status: { in: ["pending", "notified", "viewed"] },
    },
    data: { status: "removed" },
  });
}

function pickResourceId(resp: unknown): string | null {
  if (!resp || typeof resp !== "object") return null;
  const data = (resp as { data?: unknown }).data;
  if (Array.isArray(data)) {
    const first = data[0] as { id?: string } | undefined;
    return first?.id ?? null;
  }
  return (data as { id?: string } | undefined)?.id ?? null;
}

function communicateByFor(authMethod: AuthMethod): "email" | "sms" | "whatsapp" {
  if (authMethod === "whatsapp") return "whatsapp";
  return "email";
}

async function listSigners(envelopeId: string) {
  return prisma.envelopeSigner.findMany({
    where: { envelopeId },
    orderBy: [{ sourceKind: "asc" }, { sourceIndex: "asc" }],
  });
}

export const EXPORTS_FOR_TESTS = {
  CLICKSIGN_COST_CENTS,
  pickResourceId,
};
