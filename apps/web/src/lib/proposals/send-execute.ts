import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { exportPdfToBuffer } from "@/lib/render/exporter";
import {
  createEnvelope,
  addDocument,
  addSigner,
  addRequirement,
  activateEnvelope,
  deleteDraftEnvelope,
} from "@/lib/clicksign/envelopes";
import { createAcceptanceWhatsapp } from "@/lib/clicksign/acceptance";
import { getSignatureSettings } from "@/lib/clicksign/account";
import { ClicksignError } from "@/lib/clicksign/client";
import { STAGING_MODE } from "@/lib/env/staging";
import { buildAcceptanceMessage } from "./acceptance-proof";
import { renderProposalVia } from "./render";
import { selectPropostaTemplate } from "./template-select";
import { prepareSend, type PrepareResult } from "./send";
import { advanceProposalStatus } from "./status";
import { toE164BR } from "./clicksign-readiness";
import type { ClicksignRole } from "@/lib/clicksign/roles";
import type { AuthMethod } from "@/lib/clicksign/types";

function extractId(resp: unknown): string | null {
  const data = (resp as { data?: unknown })?.data;
  if (Array.isArray(data)) return (data[0] as { id?: string })?.id ?? null;
  return (data as { id?: string } | undefined)?.id ?? null;
}

// Papel ClickSign por role da proposta.
function clicksignRole(role: string): ClicksignRole {
  if (role === "proponente") return "buyer";
  if (role === "vendedor") return "seller";
  if (role === "testemunha") return "witness";
  return "party";
}

/**
 * Telefone no formato que o `signer.phone_number` da ClickSign aceita: DÍGITOS
 * NACIONAIS (DDD + número), sem `+` e sem o código do país. Mandar E.164
 * (`+55…`) retorna 422 "phone_number não está em um formato válido" — o path de
 * contratos usa `onlyDigits` (nacional) e é o formato provado. Aceita E.164 ou
 * cru; tira o `55` inicial quando o comprimento indica DDI (12-13 díg.).
 */
export function toClicksignPhone(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  let d = raw.replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  return d || undefined;
}

/**
 * Canal de notificação do signatário → método de autenticação do requirement
 * `provide_evidence`. Um signatário notificado por WhatsApp deve autenticar por
 * WhatsApp (coerente com a assinatura Plus), não por token de e-mail. Demais
 * canais caem no padrão da org (`defaultAuthMethod`, e-mail por default) — em
 * paridade com o path de contrato (`executor.ts`), que é o que funciona em prod.
 * `sms` não é `AuthMethod` na v3, então também cai no padrão.
 */
export function channelToAuth(
  channel: string | null | undefined,
  fallback: AuthMethod
): AuthMethod {
  return channel === "whatsapp" ? "whatsapp" : fallback;
}

export type SendResult =
  | { ok: true; instrument: "envelope" | "aceite"; envelopeId?: string }
  | { ok: false; block: PrepareResult };

/** Mapeia o bloqueio do prepareSend pra HTTP + corpo acionável na UI. */
export function blockToResponse(block: PrepareResult): { status: number; body: unknown } {
  if ("ok" in block) return { status: 500, body: { error: "estado inesperado" } };
  switch (block.blocked) {
    case "preflight":
      return { status: 422, body: { error: "preflight", issues: block.issues } };
    case "budget":
      return { status: 402, body: { error: "budget", ...block } };
    case "not_configured":
      return { status: 409, body: { error: "ClickSign não conectada nesta organização." } };
    case "already_sending":
      return { status: 409, body: { error: "Esta proposta já está sendo enviada." } };
    default:
      return {
        status: 400,
        body: { error: block.blocked, message: (block as { message?: string }).message },
      };
  }
}

/**
 * Executa o envio de uma proposta: compõe a DECISÃO (prepareSend) e então cria
 * o envelope ClickSign OU os Aceites via WhatsApp, avançando o status pra
 * "enviada". Best-effort no e-mail/link (o wiring da landing vem depois).
 *
 * Só o caminho FELIZ cria recursos pagos; qualquer bloqueio retorna sem gastar.
 */
export async function executeProposalSend(proposalId: string): Promise<SendResult> {
  const decision = await prepareSend(proposalId);
  if (!("ok" in decision)) return { ok: false, block: decision };

  // Claim atômico anti-duplo-envio: só UMA request move o status de um estado
  // pré-envio pra "enviada". A segunda (clique duplo / duas abas) vê count 0 e
  // é barrada ANTES de gastar — sem isso o guard do route é check-then-act e as
  // duas criam recursos pagos (2 termos de Aceite vinculantes + cobrança).
  const claim = await prisma.proposal.updateMany({
    where: {
      id: proposalId,
      status: { in: ["rascunho", "aguardando_aprovacao", "falha_envio"] },
    },
    data: { status: "enviada" },
  });
  if (claim.count === 0) {
    return { ok: false, block: { blocked: "already_sending" } };
  }

  try {
    const result = await runSend(proposalId, decision);
    // Um bloqueio APÓS o claim (ex.: proposta sumiu entre prepareSend e runSend)
    // não gastou recurso mas deixou o status em "enviada" — sem liberar, o claim
    // trava o reenvio pra sempre ("already_sending" eterno). Libera pra
    // falha_envio (reenviável).
    if (!result.ok) {
      await releaseClaim(proposalId);
    }
    return result;
  } catch (err) {
    await releaseClaim(proposalId);
    throw err;
  }
}

/** Devolve o status pra "falha_envio" quando o claim foi feito mas o envio não completou. */
async function releaseClaim(proposalId: string): Promise<void> {
  await prisma.proposal
    .updateMany({
      where: { id: proposalId, status: "enviada" },
      data: { status: "falha_envio" },
    })
    .catch(() => {});
}

async function runSend(
  proposalId: string,
  decision: Extract<PrepareResult, { ok: true }>
): Promise<SendResult> {
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) return { ok: false, block: { blocked: "no_signers" } };

  // Documento (via completa) → PDF. O Aceite usa o mesmo pra montar o comprovante.
  const tpl = proposal.templateId
    ? await prisma.contractTemplate.findUnique({ where: { id: proposal.templateId } })
    : (await selectPropostaTemplate(proposal.orgId, proposal.schemaType))?.template ?? null;
  const dataJson = (proposal.dataJson ?? {}) as Record<string, unknown>;
  const html = tpl?.handlebarsSource
    ? renderProposalVia({
        templateSource: tpl.handlebarsSource,
        schemaType: proposal.schemaType,
        dataJson,
        hiddenPaths: [],
        via: "completa",
        numero: proposal.id.slice(-8),
        comissaoIncluida: proposal.comissaoIncluida,
      })
    : (proposal.htmlContent ?? `<h1>${proposal.title}</h1>`);

  // Congela o snapshot do que está sendo enviado ANTES de criar recursos —
  // o comprovante e a página /p/[token] usam este HTML/hash, nunca a
  // re-renderização do template atual (que pode mudar entre envio e aceite).
  const snapshotHash = createHash("sha256").update(html).digest("hex");
  await prisma.proposal.update({
    where: { id: proposal.id },
    data: { sentSnapshotHtml: html, sentSnapshotHash: snapshotHash },
  });

  if (decision.instrument === "aceite") {
    return sendAceite(proposal, decision, html);
  }
  return sendEnvelope(proposal, decision, html);
}

/** Casa um signer deduplicado com a linha ProposalSigner por identidade estável. */
function matchSignerRow<T extends { cpf: string | null; email: string | null; phone: string | null; name: string }>(
  rows: T[],
  s: { cpf?: string | null; email?: string | null; phone?: string | null; name: string }
): T | undefined {
  const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
  return (
    (s.cpf ? rows.find((r) => digits(r.cpf) === digits(s.cpf)) : undefined) ??
    (s.email ? rows.find((r) => (r.email ?? "").toLowerCase() === (s.email ?? "").toLowerCase()) : undefined) ??
    (s.phone ? rows.find((r) => digits(r.phone) === digits(s.phone)) : undefined) ??
    rows.find((r) => r.name.trim().toLowerCase() === s.name.trim().toLowerCase())
  );
}

async function sendAceite(
  proposal: { id: string; orgId: string; title: string; token: string },
  decision: Extract<PrepareResult, { ok: true }>,
  _html: string
): Promise<SendResult> {
  const link = `${process.env.NEXTAUTH_URL ?? "https://staging.imobpro.ia.br"}/p/${proposal.token}`;
  const numero = proposal.id.slice(-8);

  // Carrega as linhas pra rastrear o acceptance_term POR signatário. Retry-safe:
  // um signatário que já tem acceptanceClicksignId não é reenviado (senão o
  // retry após falha parcial duplicaria termos vinculantes + cobrança).
  const rows = await prisma.proposalSigner.findMany({
    where: { proposalId: proposal.id, included: true },
  });

  let proponenteAcceptanceId: string | null = null;
  let termsCreated = 0;
  let termsPresent = 0; // criados agora + pré-existentes (retry)

  for (const s of decision.signers) {
    const row = matchSignerRow(rows, s);
    if (!row) continue;
    // Já enviado (retry) → reaproveita e não cobra de novo.
    if (row.acceptanceClicksignId) {
      termsPresent++;
      if (row.role === "proponente") proponenteAcceptanceId = row.acceptanceClicksignId;
      continue;
    }
    // A ClickSign prepende o DDI +55 sozinha e espera DÍGITOS NACIONAIS (DDD +
    // número) no signer_phone do Aceite. Mandar "55…" (E.164 sem o "+") faz o
    // "55" ser lido como DDD e o restante ser truncado — a mensagem vai pro
    // número errado (bug de entrega observado em prod). Mesmo formato nacional do
    // phone_number do envelope (toClicksignPhone), que é o comprovadamente correto.
    const phone = toClicksignPhone(s.phone) ?? "";
    if (!phone) continue;

    // try/catch por signatário: uma falha no signatário N não perde os 1..N-1
    // (já persistidos) nem re-envia a todos no retry.
    try {
      const message = buildAcceptanceMessage({ numero, title: proposal.title, link });
      const resp = await createAcceptanceWhatsapp(
        { title: `Proposta ${numero}`, message, signerName: s.name, signerPhone: phone },
        decision.creds
      );
      const acceptanceId = extractId(resp);
      if (acceptanceId) {
        await prisma.proposalSigner.update({
          where: { id: row.id },
          data: { acceptanceClicksignId: acceptanceId, acceptanceStatus: "sent" },
        });
        termsCreated++;
        termsPresent++;
        if (row.role === "proponente") proponenteAcceptanceId = acceptanceId;
      }
    } catch (err) {
      console.error(`[proposals] Aceite falhou pro signatário ${row.id}:`, err);
      // Não relança AQUI: os já enviados ficam válidos; a checagem abaixo decide
      // se o envio como um todo fracassou.
    }
  }

  const proponenteTerm =
    proponenteAcceptanceId ??
    rows.find((r) => r.role === "proponente")?.acceptanceClicksignId ??
    null;

  // Envio SÓ é sucesso se o proponente (termo vinculante) tem acceptance_term.
  // Antes, mesmo com ZERO termos criados a função marcava "enviada" e retornava
  // ok:true — o operador via "enviada" sem ninguém ter recebido, e o claim CAS
  // bloqueava o reenvio. Sem termo do proponente, lança pro executeProposalSend
  // liberar o claim (→ falha_envio, reenviável).
  if (!proponenteTerm) {
    throw new Error(
      `Aceite não criado para o proponente (termos criados: ${termsCreated}, presentes: ${termsPresent}). Envio abortado.`
    );
  }

  // Backward-compat: Proposal.acceptanceClicksignId aponta pro termo do
  // PROPONENTE (o vinculante) — antes era o 1º signatário iterado ao acaso.
  await prisma.proposal.update({
    where: { id: proposal.id },
    data: {
      instrument: "aceite",
      acceptanceClicksignId: proponenteTerm,
      sentAt: new Date(),
      reservedCostCents: decision.planCostCents,
    },
  });
  await advanceProposalStatus(proposal.id, "enviada", { sentAt: new Date() });
  return { ok: true, instrument: "aceite" };
}

async function sendEnvelope(
  proposal: { id: string; orgId: string; title: string; validUntil: Date | null },
  decision: Extract<PrepareResult, { ok: true }>,
  html: string
): Promise<SendResult> {
  const pdf = await exportPdfToBuffer(html, "A4", null);

  // Paridade com o path de contrato (executor.ts): lê os defaults da org em vez
  // de hardcodar locale/autoClose/refusable/auth.
  const settings = await getSignatureSettings(proposal.orgId);
  const defaultAuth = (settings.defaultAuthMethod as AuthMethod) ?? "email";
  const rawName = `Proposta — ${proposal.title}`;
  const name = STAGING_MODE ? `[STAGING] ${rawName}` : rawName;

  // Retry-safe: uma tentativa anterior que falhou ANTES de ativar deixa uma row
  // draft/failed com o mesmo (proposalId, via) — o @@unique bloquearia o novo
  // create. Limpa as tentativas mortas (nunca uma running/closed).
  await prisma.envelope.deleteMany({
    where: { proposalId: proposal.id, via: "completa", status: { in: ["draft", "failed"] } },
  });

  // Row local (draft) + signers.
  const envelope = await prisma.envelope.create({
    data: {
      proposalId: proposal.id,
      orgId: proposal.orgId,
      source: "proposal",
      via: "completa",
      name,
      status: "draft",
      authMethod: defaultAuth,
      signers: {
        create: decision.signers.map((s, i) => ({
          sourceKind: s.role === "vendedor" ? "vendedor" : "comprador",
          sourceIndex: i,
          role: clicksignRole(s.role),
          signingGroup: s.signingGroup,
          name: s.name,
          email: s.email ?? null,
          documentation: s.cpf ?? null,
          phone: toE164BR(s.phone) ?? null,
          notifyChannel: decision.resolvedChannels[i] ?? "email",
        })),
      },
    },
    include: { signers: true },
  });

  let clicksignId: string | null = null;
  try {
    const envResp = await createEnvelope(
      {
        name: envelope.name,
        autoClose: settings.autoClose,
        locale: settings.defaultLocale === "en-US" ? "en-US" : "pt-BR",
        deadlineAt: proposal.validUntil ?? undefined,
      },
      decision.creds
    );
    clicksignId = extractId(envResp);
    if (!clicksignId) throw new Error("Envelope sem id");

    const docResp = await addDocument(
      { envelopeId: clicksignId, filename: "proposta.pdf", contentBase64: pdf.toString("base64") },
      decision.creds
    );
    const documentClicksignId = extractId(docResp);
    if (!documentClicksignId) throw new Error("Documento sem id");

    for (const local of envelope.signers) {
      const sResp = await addSigner(
        {
          envelopeId: clicksignId,
          name: local.name,
          email: local.email ?? undefined,
          documentation: local.documentation ?? undefined,
          phoneNumber: toClicksignPhone(local.phone),
          hasDocumentation: Boolean(local.documentation),
          refusable: settings.refusable,
          group: local.signingGroup ?? undefined,
          notifyChannel: (local.notifyChannel as "email" | "whatsapp" | "sms") ?? "email",
        },
        decision.creds
      );
      const signerId = extractId(sResp);
      if (!signerId) throw new Error("Signer sem id");

      // Autenticação coerente com o canal (whatsapp→whatsapp), com fallback pro
      // padrão da org se a ClickSign recusar o método (422) — sem derrubar o
      // envelope inteiro por causa do auth.
      const preferredAuth = channelToAuth(local.notifyChannel, defaultAuth);
      let authReq;
      try {
        authReq = await addRequirement(
          { envelopeId: clicksignId, documentClicksignId, signerClicksignId: signerId, action: "provide_evidence", auth: preferredAuth },
          decision.creds
        );
      } catch (e) {
        if (e instanceof ClicksignError && e.status === 422 && preferredAuth !== defaultAuth) {
          authReq = await addRequirement(
            { envelopeId: clicksignId, documentClicksignId, signerClicksignId: signerId, action: "provide_evidence", auth: defaultAuth },
            decision.creds
          );
        } else {
          throw e;
        }
      }
      const signReq = await addRequirement(
        { envelopeId: clicksignId, documentClicksignId, signerClicksignId: signerId, action: "agree", role: (local.role as ClicksignRole) ?? "party" },
        decision.creds
      );
      await prisma.envelopeSigner.update({
        where: { id: local.id },
        data: {
          clicksignId: signerId,
          signatureKey: signerId,
          requirementIds: [extractId(authReq), extractId(signReq)].filter(Boolean) as string[],
        },
      });
    }

    await activateEnvelope(clicksignId, decision.creds);

    await prisma.envelope.update({
      where: { id: envelope.id },
      data: {
        clicksignId,
        documentClicksignId,
        status: "running",
        sentAt: new Date(),
        costCents: decision.planCostCents,
      },
    });
    await prisma.envelopeSigner.updateMany({
      where: { envelopeId: envelope.id, status: "pending" },
      data: { status: "notified", notifiedAt: new Date() },
    });
    await prisma.proposal.update({
      where: { id: proposal.id },
      data: { instrument: "envelope", sentAt: new Date(), reservedCostCents: decision.planCostCents },
    });
    await advanceProposalStatus(proposal.id, "enviada", { sentAt: new Date() });

    return { ok: true, instrument: "envelope", envelopeId: envelope.id };
  } catch (err) {
    console.error("[proposals] falha no envio:", err);
    if (clicksignId) await deleteDraftEnvelope(clicksignId, decision.creds).catch(() => {});
    await prisma.envelope.update({
      where: { id: envelope.id },
      data: { status: "failed", lastError: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}
