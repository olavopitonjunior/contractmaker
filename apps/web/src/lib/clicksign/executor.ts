import { prisma } from "@/lib/db/prisma";
import { withOrgBudgetLock } from "@/lib/security/budget-lock";
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
  getEnvelope,
  listEnvelopeSigners,
  type ClicksignRole,
} from "./envelopes";
import { ClicksignError, type ClicksignCreds } from "./client";
import { dealDataToSigners, leaseDataToSigners } from "./mapping";
import {
  AuthMethodNotAllowedError,
  getSignatureSettings,
  requireClickSignCreds,
  resolveClickSignCreds,
} from "./account";
import { moduleForDealKind } from "@/lib/modules/resolve";
import { MODULE } from "@/lib/modules/catalog";
import {
  CLICKSIGN_COST_CENTS,
  envelopeCostCents,
  getMonthlyBudgetCents,
} from "./costs";
import type { AuthMethod } from "./types";
import type { OrgSignatureSettings } from "@prisma/client";
import { STAGING_MODE } from "@/lib/env/staging";

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
  sourceKind:
    | "vendedor"
    | "comprador"
    | "testemunha"
    | "corretora"
    | "locador"
    | "locatario"
    | "fiador";
  sourceIndex: number;
  subKind?: "titular" | "conjuge" | "procurador" | "representante" | "avulso";
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
  /** Lista explícita de signatários vinda da popup de envio. Quando presente,
   *  é AUTORITATIVA: substitui a derivação de `dataJson` (dealDataToSigners).
   *  Permite o operador remover qualquer parte (inclusive titular) e adicionar
   *  avulsos pra ESTE envelope sem mexer no contrato. Sem ela (Newton/bearer,
   *  locação direta), cai na derivação por dataJson. */
  signers?: EnvelopeSignerInput[];
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
  /** Papel derivado da parte (titular/cônjuge/procurador/representante). Usado
   *  pra casar o override de "Assina como" e o role default. Não persiste. */
  subKind?: "titular" | "conjuge" | "procurador" | "representante" | "avulso";
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
  /** Credenciais ClickSign da org (resolvidas no entry-point). */
  creds: ClicksignCreds;
  /** Preferências de assinatura da org (padrões de envelope + custo). */
  settings: OrgSignatureSettings;
}) {
  const {
    orgId,
    dealId,
    contractId,
    attachmentId,
    source,
    name: rawName,
    authMethod,
    deadlineAt: rawDeadlineAt,
    pdfBuffer,
    filename,
    storageKeyPrefix,
    creds,
    settings,
  } = input;

  // Testemunhas padrão da imobiliária são FORÇADAS no servidor (merge + dedupe),
  // valendo em TODOS os caminhos — popup, Newton/bearer e avulsos. Antes a
  // injeção só existia client-side e sumia fora do diálogo (bug reportado).
  const signers = await mergeDefaultWitnesses(orgId, input.signers);

  if (signers.length === 0) {
    throw new Error("Nenhum signatário válido encontrado");
  }

  // Prazo default da org quando o envio não especifica um.
  const deadlineAt =
    rawDeadlineAt ??
    (settings.defaultDeadlineDays && settings.defaultDeadlineDays > 0
      ? new Date(Date.now() + settings.defaultDeadlineDays * 86_400_000)
      : null);

  // Ordem sequencial default da org: só aplica quando nenhum signer já traz
  // grupo explícito (a popup "Assinar em ordem" tem precedência).
  const applyDefaultOrder =
    settings.defaultSequential && signers.every((s) => s.group == null);

  // Prefixo [STAGING] no nome do envelope deixa claro pra signatário em caso
  // de vazamento + facilita identificar/filtrar no dashboard ClickSign.
  const name = STAGING_MODE ? `[STAGING] ${rawName}` : rawName;

  const overrides = settings.costOverridesJson as Record<string, unknown> | null;
  const planCost = envelopeCostCents(
    signers.map(() => authMethod),
    overrides
  );
  const budget = getMonthlyBudgetCents(settings.monthlyBudgetCents);

  // 1. Snapshot do PDF (best-effort). Fora do lock — é rede/storage.
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
    // Match canônico por (sourceKind, sourceIndex, subKind). subKind desambigua
    // titular/cônjuge/procurador/representante de uma MESMA parte (mesmo
    // sourceIndex). Quando o override não traz subKind, casa por (kind,index).
    const override = input.signerRoles?.find(
      (r) =>
        r.sourceKind === s.sourceKind &&
        r.sourceIndex === (s.sourceIndex ?? 0) &&
        (r.subKind == null || r.subKind === (s.subKind ?? "titular"))
    );
    const role: ClicksignRole =
      s.role ??
      override?.role ??
      defaultRoleForSourceKind(s.sourceKind ?? "outro", s.subKind);
    const group = s.group ?? override?.group ?? null;
    return { role, group };
  };

  // 2. Cria row local com status=draft — sob advisory lock por org pra fechar
  // o TOCTOU do budget: o check (soma running+closed+draft do mês) e o create
  // acontecem atomicamente, então dois envios paralelos da mesma org não furam
  // o teto. Drafts do mês entram na conta pra que um envio in-flight seja
  // visível ao concorrente (draft órfão é limpo por deleteDraftEnvelope).
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const envelope = await withOrgBudgetLock("clicksign", orgId, async (tx) => {
    // Re-checa "1 envelope ativo por contrato" DENTRO do lock. O check no
    // entry-point (sendEnvelopeForContract) roda antes do lock, então dois
    // envios paralelos do mesmo contrato passavam ambos e criavam 2 envelopes
    // ClickSign (cobrança dobrada + 2 e-mails por signatário). Aqui é
    // serializado com o create do draft.
    if (contractId) {
      const active = await tx.envelope.findFirst({
        where: {
          contractId,
          status: { in: ["draft", "running", "closed"] },
        },
        select: { id: true, status: true },
      });
      if (active) {
        throw new Error(
          `Já existe um envelope ${active.status} para este contrato (id ${active.id})`
        );
      }
    }

    const agg = await tx.envelope.aggregate({
      where: {
        orgId,
        sentAt: { gte: start },
        status: { in: ["running", "closed", "draft"] },
      },
      _sum: { costCents: true },
    });
    const spent = agg._sum.costCents ?? 0;
    if (spent + planCost > budget) {
      throw new EnvelopeBudgetError(
        "Orçamento mensal Clicksign excedido",
        spent,
        budget,
        planCost
      );
    }
    return tx.envelope.create({
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
      costCents: planCost,
      sentAt: new Date(),
      signers: {
        create: signers.map((s, idx) => {
          const { role, group } = resolveRoleGroup(s);
          const finalGroup = applyDefaultOrder ? idx + 1 : group;
          return {
            sourceKind: s.sourceKind ?? "outro",
            sourceIndex: s.sourceIndex ?? 0,
            role,
            signingGroup: finalGroup,
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
  });

  // 3. Sequência Clicksign. Em qualquer falha, marca failed + limpa draft.
  let clicksignEnvelopeId: string | null = null;
  try {
    const envResp = await createEnvelope(
      {
        name: envelope.name,
        deadlineAt: envelope.deadlineAt ?? undefined,
        locale: settings.defaultLocale === "en-US" ? "en-US" : "pt-BR",
        autoClose: settings.autoClose,
      },
      creds
    );
    clicksignEnvelopeId = pickResourceId(envResp);
    if (!clicksignEnvelopeId) throw new Error("Resposta sem id de envelope");

    const base64 = pdfBuffer.toString("base64");
    const docResp = await addDocument(
      {
        envelopeId: clicksignEnvelopeId,
        filename,
        contentBase64: base64,
      },
      creds
    );
    const documentClicksignId = pickResourceId(docResp);
    if (!documentClicksignId) throw new Error("Resposta sem id de documento");

    const signerIdMap = new Map<string, { signerId: string; reqIds: string[] }>();
    for (const localSigner of envelope.signers) {
      const signerResp = await addSigner(
        {
          envelopeId: clicksignEnvelopeId,
          name: localSigner.name,
          email: localSigner.email,
          documentation: localSigner.documentation ?? undefined,
          phoneNumber: localSigner.phone ?? undefined,
          hasDocumentation: Boolean(localSigner.documentation),
          group: localSigner.signingGroup ?? undefined,
          refusable: settings.refusable,
        },
        creds
      );
      const signerId = pickResourceId(signerResp);
      if (!signerId) throw new Error("Resposta sem id de signer");

      const authReq = await addRequirement(
        {
          envelopeId: clicksignEnvelopeId,
          documentClicksignId,
          signerClicksignId: signerId,
          action: "provide_evidence",
          auth: authMethod,
        },
        creds
      );
      // Role já resolvido e persistido no row (input → override → default).
      const role: ClicksignRole =
        (localSigner.role as ClicksignRole | null) ??
        defaultRoleForSourceKind(localSigner.sourceKind);
      const signReq = await addRequirement(
        {
          envelopeId: clicksignEnvelopeId,
          documentClicksignId,
          signerClicksignId: signerId,
          action: "agree",
          role,
        },
        creds
      );
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

    await activateEnvelope(clicksignEnvelopeId, creds);

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
        await deleteDraftEnvelope(clicksignEnvelopeId, creds);
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
  const contract = await prisma.contract.findUnique({
    where: { id: input.contractId },
    include: {
      deal: { include: { pipeline: { select: { orgId: true, kind: true } } } },
    },
  });
  if (!contract) throw new Error("Contrato não encontrado");
  if (contract.status !== "aprovado") {
    throw new Error("Contrato precisa estar aprovado antes de enviar");
  }
  const orgId = contract.deal?.pipeline?.orgId;
  if (!orgId) throw new Error("Deal sem organização vinculada");

  // Gating multitenant: sem conta ClickSign conectada (e não sendo a org legada
  // com fallback global), NÃO envia. Resolvido cedo, antes de gerar o PDF.
  const creds = await requireClickSignCreds(orgId);
  const settings = await getSignatureSettings(orgId);
  const authMethod: AuthMethod =
    input.authMethod ?? (settings.defaultAuthMethod as AuthMethod);
  // Só métodos habilitados nas preferências da org (defense-in-depth — a UI já
  // restringe o seletor à allow-list).
  if (
    settings.allowedAuthMethods.length > 0 &&
    !settings.allowedAuthMethods.includes(authMethod)
  ) {
    throw new AuthMethodNotAllowedError(authMethod);
  }

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

  // Signatários: a popup de envio manda uma lista explícita (autoritativa).
  // Sem ela (Newton/bearer, locação direta), derivamos do dataJson conforme o
  // tipo de pipeline (locação: locador/locatário/fiador; venda: vendedor/etc.).
  let envelopeSigners: EnvelopeSignerInput[];
  if (input.signers && input.signers.length > 0) {
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
    envelopeSigners = input.signers;
  } else {
    const dataSource =
      (contract.dataJson as Record<string, unknown> | null) ?? null;
    const { signers, missing } =
      moduleForDealKind(contract.deal?.pipeline?.kind) === MODULE.LOCACAO
        ? leaseDataToSigners(dataSource, authMethod)
        : dealDataToSigners(dataSource, authMethod);
    if (missing.length > 0) throw new MissingEmailsError(missing);
    envelopeSigners = signers.map((s) => ({
      name: s.name,
      email: s.email,
      documentation: s.documentation,
      phone: s.phone,
      sourceKind: s.sourceKind,
      sourceIndex: s.sourceIndex,
      subKind: s.subKind,
    }));
  }

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
    signers: envelopeSigners.map((s) => ({
      name: s.name,
      email: s.email,
      documentation: s.documentation,
      phone: s.phone,
      sourceKind: s.sourceKind,
      sourceIndex: s.sourceIndex,
      subKind: s.subKind,
      role: s.role,
      group: s.group,
    })),
    signerRoles: input.signerRoles,
    pdfBuffer,
    filename,
    storageKeyPrefix: `envelopes/${contract.id}/`,
    creds,
    settings,
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

  // Gating multitenant + preferências da org (default do método de assinatura).
  const creds = await requireClickSignCreds(orgId);
  const settings = await getSignatureSettings(orgId);
  const authMethod: AuthMethod =
    input.authMethod ?? (settings.defaultAuthMethod as AuthMethod);
  // Só métodos habilitados nas preferências da org (defense-in-depth — a UI já
  // restringe o seletor à allow-list).
  if (
    settings.allowedAuthMethods.length > 0 &&
    !settings.allowedAuthMethods.includes(authMethod)
  ) {
    throw new AuthMethodNotAllowedError(authMethod);
  }

  // 2026-06-03 — Limpa drafts ÓRFÃOS (row local status=draft que nunca chegou a
  // virar envelope na ClickSign — `clicksignId=null`; tipicamente um timeout no
  // meio do fluxo de createEnvelopeFromBuffer). Sem isso, um draft preso BLOQUEIA
  // qualquer reenvio do documento pra sempre (bug visto no deal Walter Santos).
  await prisma.envelope.updateMany({
    where: { attachmentId: attachment.id, status: "draft", clicksignId: null },
    data: {
      status: "failed",
      lastError: "Draft órfão (nunca enviado à ClickSign) — limpo automaticamente",
      canceledAt: new Date(),
    },
  });

  // Bloqueia só envelopes GENUINAMENTE ativos pro mesmo attachment: rodando, ou
  // draft real já criado na ClickSign (clicksignId presente). Drafts órfãos já
  // foram limpos acima.
  const existingActive = await prisma.envelope.findFirst({
    where: {
      attachmentId: attachment.id,
      OR: [
        { status: "running" },
        { status: "draft", clicksignId: { not: null } },
      ],
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
    creds,
    settings,
  });
}

function remoteEnvelopeStatus(resp: unknown): string | null {
  const data = (resp as { data?: { attributes?: { status?: string } } })?.data;
  return data?.attributes?.status ?? null;
}

function remoteSignerCount(resp: unknown): number | null {
  const data = (resp as { data?: unknown })?.data;
  return Array.isArray(data) ? data.length : null;
}

/**
 * Cancela um envelope de forma RESILIENTE: reconcilia com o estado real na
 * ClickSign antes de agir e nunca deixa o envelope local preso em `running`.
 *
 * Casos tratados:
 *  - Remoto `closed` (já assinado) → lança 409 claro; NÃO marca cancelado.
 *  - Remoto `canceled`/404 (já removido) → idempotente, só sincroniza local.
 *  - Remoto `draft` → DELETE; `running` → PATCH status=canceled.
 *  - PATCH recusado (ex.: envelope `running` SEM signers, morto — o usuário
 *    removeu todos os assinantes antes de cancelar, e a ClickSign responde
 *    "status deve estar em: draft, running"): força cancelamento local +
 *    grava `lastError`, pois um envelope sem signatários nunca será assinado.
 *  - PATCH recusado num envelope ainda VIVO (running COM signers) → re-lança,
 *    pra não dessincronizar (o envelope continua ativo na ClickSign).
 */
export async function cancelEnvelopeFlow(envelopeId: string): Promise<void> {
  const envelope = await prisma.envelope.findUnique({
    where: { id: envelopeId },
  });
  if (!envelope) throw new Error("Envelope não encontrado");

  let lastError: string | null = null;

  // Credenciais da org do envelope. Se a conta foi desconectada, `creds` vem
  // null: pulamos as chamadas remotas e só cancelamos localmente.
  const creds = await resolveClickSignCreds(envelope.orgId);

  if (envelope.clicksignId && creds) {
    const clicksignId = envelope.clicksignId;

    // 1. Descobre o status remoto real (o local pode estar defasado).
    let remoteStatus: string | null = null;
    let remoteGone = false;
    try {
      remoteStatus = remoteEnvelopeStatus(await getEnvelope(clicksignId, creds));
    } catch (err) {
      if (err instanceof ClicksignError && err.status === 404) {
        remoteGone = true;
      }
      // Outros erros de GET: não bloqueiam; tentamos cancelar assim mesmo.
    }

    if (remoteStatus === "closed") {
      throw new ClicksignError(
        "Clicksign: envelope já foi finalizado (assinado) e não pode ser cancelado.",
        409
      );
    }

    // 2. Só chama a API de cancelamento se ainda não estiver removido/cancelado.
    if (!remoteGone && remoteStatus !== "canceled") {
      const isDraft = remoteStatus === "draft" || envelope.status === "draft";
      try {
        if (isDraft) {
          await deleteDraftEnvelope(clicksignId, creds);
        } else {
          await cancelEnvelope(clicksignId, creds);
        }
      } catch (err) {
        if (err instanceof ClicksignError && err.status === 404) {
          // Já removido — segue pro update local.
        } else {
          // 3. Falha ao cancelar. Re-checa o remoto pra decidir com segurança.
          const decision = await resolveCancelFailure(clicksignId, creds);
          if (decision === "closed") {
            throw new ClicksignError(
              "Clicksign: envelope já foi finalizado (assinado) e não pode ser cancelado.",
              409
            );
          }
          if (decision === "force") {
            // Envelope `running` sem signers (morto): força cancelamento local.
            lastError =
              err instanceof Error ? err.message : String(err);
          } else if (decision !== "reconcile") {
            // Envelope ainda vivo (running COM signers) ou não conseguimos
            // confirmar — re-lança pra não dessincronizar.
            throw err;
          }
          // decision === "reconcile" (virou canceled): cai no update local.
        }
      }
    }
  }

  await prisma.envelope.update({
    where: { id: envelopeId },
    data: {
      status: "canceled",
      canceledAt: new Date(),
      ...(lastError ? { lastError: lastError.slice(0, 500) } : {}),
    },
  });
  await prisma.envelopeSigner.updateMany({
    where: {
      envelopeId,
      status: { in: ["pending", "notified", "viewed"] },
    },
    data: { status: "removed" },
  });
}

/**
 * Após uma falha no cancelamento, consulta a ClickSign pra decidir o que fazer:
 *  - "closed"    → o envelope foi finalizado; não cancelar localmente.
 *  - "reconcile" → já está canceled/removido remotamente; sincroniza local.
 *  - "force"     → running SEM signers (morto); pode cancelar só localmente.
 *  - "rethrow"   → running COM signers (vivo) ou incerto; propaga o erro.
 */
async function resolveCancelFailure(
  clicksignId: string,
  creds: ClicksignCreds
): Promise<"closed" | "reconcile" | "force" | "rethrow"> {
  let status: string | null;
  try {
    status = remoteEnvelopeStatus(await getEnvelope(clicksignId, creds));
  } catch (err) {
    if (err instanceof ClicksignError && err.status === 404) return "reconcile";
    return "rethrow";
  }

  if (status === "closed") return "closed";
  if (status === "canceled" || status === null) return "reconcile";
  if (status === "draft") return "rethrow"; // draft deveria ter sido deletado

  // status === "running": só é seguro forçar se não houver mais signatários.
  try {
    const count = remoteSignerCount(await listEnvelopeSigners(clicksignId, creds));
    return count === 0 ? "force" : "rethrow";
  } catch {
    return "rethrow";
  }
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

function defaultRoleForSourceKind(
  sourceKind: string,
  subKind?: "titular" | "conjuge" | "procurador" | "representante" | "avulso"
): ClicksignRole {
  // Papéis derivados da parte têm qualificação própria, independente do
  // sourceKind. Representante (PJ) assina NO LUGAR da parte → mantém o papel
  // da parte (cai no switch abaixo).
  if (subKind === "conjuge") return "consenting";
  if (subKind === "procurador") return "attorney";
  switch (sourceKind) {
    case "vendedor":
      return "seller";
    case "comprador":
      return "buyer";
    case "testemunha":
      return "witness";
    case "corretora":
      return "intervening";
    // Locação — usar só qualificações já existentes no enum ClicksignRole
    // (role desconhecido → 422 na ClickSign).
    case "locador":
      return "party";
    case "locatario":
      return "party";
    case "fiador":
      return "consenting";
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

const onlyDigits = (v?: string | null) => (v ?? "").replace(/\D/g, "");

/**
 * Testemunhas padrão da imobiliária FORÇADAS no servidor. Lê DefaultWitness
 * (isDefault) da org e mescla nos signers, dedupando por e-mail (lowercase) ou
 * CPF (dígitos) contra quem já está no envelope. Vale em TODOS os caminhos de
 * envio — antes a injeção só existia no diálogo e sumia no Newton/bearer e nos
 * avulsos (bug "assinantes padrão não funcionam"). Testemunhas sem e-mail são
 * ignoradas (não dá pra notificar).
 */
export async function mergeDefaultWitnesses(
  orgId: string,
  signers: EnvelopeSignerInput[]
): Promise<EnvelopeSignerInput[]> {
  const defaults = await prisma.defaultWitness.findMany({
    where: { orgId, isDefault: true },
  });
  if (defaults.length === 0) return signers;

  const emails = new Set(
    signers.map((s) => s.email?.toLowerCase().trim()).filter(Boolean)
  );
  const cpfs = new Set(
    signers.map((s) => onlyDigits(s.documentation)).filter((d) => d.length > 0)
  );
  let nextIndex =
    Math.max(
      -1,
      ...signers
        .filter((s) => s.sourceKind === "testemunha")
        .map((s) => s.sourceIndex ?? 0)
    ) + 1;

  const merged = [...signers];
  for (const w of defaults) {
    const email = w.email?.toLowerCase().trim();
    if (!email || !email.includes("@")) continue; // sem e-mail → não notifica
    const cpf = onlyDigits(w.cpf);
    if (emails.has(email) || (cpf && cpfs.has(cpf))) continue; // já presente
    emails.add(email);
    if (cpf) cpfs.add(cpf);
    merged.push({
      name: w.nome,
      email: w.email,
      documentation: w.cpf ?? null,
      phone: w.mobilePhone ?? null,
      sourceKind: "testemunha",
      sourceIndex: nextIndex++,
      subKind: "avulso",
      role: "witness",
    });
  }
  return merged;
}

export const EXPORTS_FOR_TESTS = {
  CLICKSIGN_COST_CENTS,
  pickResourceId,
};
