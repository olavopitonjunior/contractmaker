import { prisma } from "@/lib/db/prisma";
import { uploadBufferToStorage, downloadBufferFromUrl } from "@/lib/storage/s3";
import { generateContractPdfBuffer } from "@/lib/render/contract-pdf";
import {
  activateEnvelope,
  addDocument,
  addRequirement,
  addSigner,
  cancelEnvelope,
  createEnvelope,
  deleteDraftEnvelope,
  type ClicksignRole,
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

/** Override de role ClickSign por signer — UI permite usuário escolher
 *  via select na popup. Match canônico por (sourceKind, sourceIndex,
 *  subKind). Fallback pro defaultRoleForSourceKind quando signer não
 *  tem override. */
export interface SignerRoleOverride {
  sourceKind: "vendedor" | "comprador" | "testemunha" | "corretora";
  sourceIndex: number;
  subKind?: "titular" | "conjuge";
  role: ClicksignRole;
  /** Grupo de ordem (ClickSign v3). Null/omitido = paralelo. */
  group?: number | null;
}

interface SendEnvelopeInput {
  contractId: string;
  authMethod?: AuthMethod;
  envelopeName?: string;
  deadlineAt?: Date | null;
  signerRoles?: SignerRoleOverride[];
}

/** Signer payload aceito pelo helper interno e pelo fluxo avulso. */
export interface EnvelopeSignerInput {
  name: string;
  email: string;
  documentation?: string | null;
  phone?: string | null;
  /** Origem semântica do signer no dataJson — quando aplicável. Para signers
   *  avulsos digitados manualmente, default = "outro" / index 0. */
  sourceKind?: string;
  sourceIndex?: number;
  /** Qualificação ClickSign escolhida na UI ("Assina como"). */
  role?: ClicksignRole;
  /** Grupo de ordem de assinatura. Null/omitido = paralelo. */
  group?: number | null;
}

interface SendEnvelopeForAttachmentInput {
  attachmentId: string;
  authMethod?: AuthMethod;
  envelopeName?: string;
  deadlineAt?: Date | null;
  signers: EnvelopeSignerInput[];
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
 * Executa o fluxo Clicksign a partir de um PDF já em buffer. Compartilhado
 * pelos dois entry-points: `sendEnvelopeForContract` (CCV aprovado) e
 * `sendEnvelopeForAttachment` (documento avulso da pasta Documentos).
 *
 * Faz: budget check → upload snapshot → cria Envelope local → cria envelope
 * remoto + document + signers + requirements → ativa. Em qualquer falha,
 * marca envelope local `failed` e tenta limpar o draft remoto.
 */
async function createEnvelopeFromBuffer(input: {
  orgId: string;
  dealId: string;
  contractId: string | null;
  attachmentId: string | null;
  source: "contract" | "attachment";
  name: string;
  authMethod: AuthMethod;
  deadlineAt: Date | null;
  signers: EnvelopeSignerInput[];
  signerRoles?: SignerRoleOverride[];
  pdfBuffer: Buffer;
  filename: string;
  /** Prefixo do path Blob ("envelopes/<id>/"). Usado pra organizar snapshots. */
  storageKeyPrefix: string;
}) {
  const {
    orgId,
    dealId,
    contractId,
    attachmentId,
    source,
    name,
    authMethod,
    deadlineAt,
    signers,
    pdfBuffer,
    filename,
    storageKeyPrefix,
  } = input;

  if (signers.length === 0) {
    throw new Error("Nenhum signatário válido encontrado");
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

  // 1. Snapshot do PDF (best-effort).
  let documentUrl: string | null = null;
  try {
    documentUrl = await uploadBufferToStorage({
      bucket: process.env.S3_BUCKET,
      key: `${storageKeyPrefix}${Date.now()}-${filename}`,
      body: pdfBuffer,
      contentType: "application/pdf",
    });
  } catch (err) {
    console.error("[clicksign] falha ao fazer upload do snapshot:", err);
  }

  // Resolve role + grupo de ordem por signer: precedência role explícito do
  // input → override por (sourceKind,sourceIndex) → default por sourceKind.
  // Persistimos no row pra exibir na aba Assinaturas e re-criar requirement.
  const resolveRoleGroup = (s: EnvelopeSignerInput) => {
    const override = input.signerRoles?.find(
      (r) =>
        r.sourceKind === s.sourceKind && r.sourceIndex === (s.sourceIndex ?? 0)
    );
    const role: ClicksignRole =
      s.role ?? override?.role ?? defaultRoleForSourceKind(s.sourceKind ?? "outro");
    const group = s.group ?? override?.group ?? null;
    return { role, group };
  };

  // 2. Cria row local com status=draft.
  const envelope = await prisma.envelope.create({
    data: {
      contractId,
      attachmentId,
      dealId,
      orgId,
      source,
      name,
      status: "draft",
      authMethod,
      documentUrl,
      deadlineAt,
      signers: {
        create: signers.map((s) => {
          const { role, group } = resolveRoleGroup(s);
          return {
            sourceKind: s.sourceKind ?? "outro",
            sourceIndex: s.sourceIndex ?? 0,
            role,
            signingGroup: group,
            name: s.name,
            email: s.email,
            documentation: s.documentation ?? null,
            phone: s.phone ?? null,
            authMethod,
            status: "pending",
          };
        }),
      },
    },
    include: { signers: true },
  });

  // 3. Sequência Clicksign. Em qualquer falha, marca failed + limpa draft.
  let clicksignEnvelopeId: string | null = null;
  try {
    const envResp = await createEnvelope({
      name: envelope.name,
      deadlineAt: envelope.deadlineAt ?? undefined,
    });
    clicksignEnvelopeId = pickResourceId(envResp);
    if (!clicksignEnvelopeId) throw new Error("Resposta sem id de envelope");

    const base64 = pdfBuffer.toString("base64");
    const docResp = await addDocument({
      envelopeId: clicksignEnvelopeId,
      filename,
      contentBase64: base64,
    });
    const documentClicksignId = pickResourceId(docResp);
    if (!documentClicksignId) throw new Error("Resposta sem id de documento");

    const signerIdMap = new Map<string, { signerId: string; reqIds: string[] }>();
    for (const localSigner of envelope.signers) {
      const signerResp = await addSigner({
        envelopeId: clicksignEnvelopeId,
        name: localSigner.name,
        email: localSigner.email,
        documentation: localSigner.documentation ?? undefined,
        phoneNumber: localSigner.phone ?? undefined,
        hasDocumentation: Boolean(localSigner.documentation),
        group: localSigner.signingGroup ?? undefined,
      });
      const signerId = pickResourceId(signerResp);
      if (!signerId) throw new Error("Resposta sem id de signer");

      const authReq = await addRequirement({
        envelopeId: clicksignEnvelopeId,
        documentClicksignId,
        signerClicksignId: signerId,
        action: "provide_evidence",
        auth: authMethod,
      });
      // Role já resolvido e persistido no row (input → override → default).
      const role: ClicksignRole =
        (localSigner.role as ClicksignRole | null) ??
        defaultRoleForSourceKind(localSigner.sourceKind);
      const signReq = await addRequirement({
        envelopeId: clicksignEnvelopeId,
        documentClicksignId,
        signerClicksignId: signerId,
        action: "agree",
        role,
      });
      const reqIds = [
        pickResourceId(authReq),
        pickResourceId(signReq),
      ].filter(Boolean) as string[];
      signerIdMap.set(localSigner.id, { signerId, reqIds });
    }

    await Promise.all(
      Array.from(signerIdMap.entries()).map(([localId, info]) =>
        prisma.envelopeSigner.update({
          where: { id: localId },
          data: { clicksignId: info.signerId, requirementIds: info.reqIds },
        })
      )
    );

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
    await prisma.envelopeSigner.updateMany({
      where: { envelopeId: envelope.id, status: "pending" },
      data: { status: "notified", notifiedAt: new Date() },
    });

    return { ...updated, signers: await listSigners(envelope.id) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[clicksign] falha durante o envio:", msg);
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

/**
 * Executa o fluxo completo de envio de um Contract aprovado. Reaproveita
 * `createEnvelopeFromBuffer` — só monta os signers a partir do dataJson e
 * gera o PDF via Puppeteer/Drive antes de delegar.
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

  const { buffer: pdfBuffer, filename } = await generateContractPdfBuffer(
    contract.id
  );

  return createEnvelopeFromBuffer({
    orgId,
    dealId: contract.dealId,
    contractId: contract.id,
    attachmentId: null,
    source: "contract",
    name:
      input.envelopeName ||
      `Contrato ${contract.deal?.title || contract.id} (v${contract.version})`,
    authMethod,
    deadlineAt: input.deadlineAt ?? null,
    signers: signers.map((s) => ({
      name: s.name,
      email: s.email,
      documentation: s.documentation,
      phone: s.phone,
      sourceKind: s.sourceKind,
      sourceIndex: s.sourceIndex,
    })),
    signerRoles: input.signerRoles,
    pdfBuffer,
    filename,
    storageKeyPrefix: `envelopes/${contract.id}/`,
  });
}

/**
 * Envia um DealAttachment (PDF) direto pra ClickSign sem precisar passar por
 * Contract aprovado. Caso de uso: aditivos, distratos, procurações, recibos —
 * docs avulsos da pasta Documentos. Os signers vêm 100% do input (manual ou
 * pré-preenchidos pela UI a partir das partes do deal).
 */
export async function sendEnvelopeForAttachment(
  input: SendEnvelopeForAttachmentInput
) {
  const authMethod: AuthMethod = input.authMethod ?? "email";

  if (!input.signers || input.signers.length === 0) {
    throw new Error("Informe ao menos um signatário");
  }
  // Sanity check de email — espelha a guarda do dealDataToSigners.
  const missingEmail = input.signers
    .map((s, i) => ({ ...s, idx: i }))
    .filter((s) => !s.email || !s.email.includes("@"));
  if (missingEmail.length > 0) {
    throw new MissingEmailsError(
      missingEmail.map((m) => ({
        sourceKind: m.sourceKind ?? "outro",
        sourceIndex: m.sourceIndex ?? m.idx,
        name: m.name,
      }))
    );
  }

  const attachment = await prisma.dealAttachment.findUnique({
    where: { id: input.attachmentId },
    include: {
      deal: { include: { pipeline: { select: { orgId: true } } } },
    },
  });
  if (!attachment) throw new Error("Documento não encontrado");
  if (attachment.mime !== "application/pdf") {
    throw new Error(
      "Apenas documentos PDF podem ser enviados pra assinatura. Converta o arquivo antes."
    );
  }

  const orgId = attachment.deal.pipeline.orgId;
  if (!orgId) throw new Error("Deal sem organização vinculada");

  // Bloqueia múltiplos envelopes ativos pro mesmo attachment.
  const existingActive = await prisma.envelope.findFirst({
    where: {
      attachmentId: attachment.id,
      status: { in: ["draft", "running"] },
    },
  });
  if (existingActive) {
    throw new Error(
      `Já existe um envelope ${existingActive.status} para esse documento (id ${existingActive.id})`
    );
  }

  // Baixa o PDF do storage (Vercel Blob ou S3, conforme a app).
  const pdfBuffer = await downloadBufferFromUrl(attachment.url);

  return createEnvelopeFromBuffer({
    orgId,
    dealId: attachment.dealId,
    contractId: null,
    attachmentId: attachment.id,
    source: "attachment",
    name: input.envelopeName || attachment.filename,
    authMethod,
    deadlineAt: input.deadlineAt ?? null,
    signers: input.signers,
    pdfBuffer,
    filename: attachment.filename,
    storageKeyPrefix: `envelopes/attachment/${attachment.id}/`,
  });
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

// Removido `communicateByFor` — ClickSign v3 não aceita communicate_by no
// signer (422 "não está disponível"). Email é automático via `signer.email`
// + `activateEnvelope`. WhatsApp/SMS são modeladas como Auth requirements
// (POST /requirements com action="provide_evidence", auth=whatsapp), não
// como canal de comunicação do signer.

function defaultRoleForSourceKind(sourceKind: string): ClicksignRole {
  switch (sourceKind) {
    case "vendedor":
      return "seller";
    case "comprador":
      return "buyer";
    case "testemunha":
      return "witness";
    case "corretora":
      return "intervening";
    default:
      return "sign";
  }
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
