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
import { getSignatureSettings, resolveClickSignCreds } from "@/lib/clicksign/account";
import type { ClickSignCreds } from "@/lib/clicksign/account";
import { getMonthlySpendCents } from "@/lib/clicksign/executor";
import { getMonthlyBudgetCents } from "@/lib/clicksign/costs";
import { ClicksignError } from "@/lib/clicksign/client";
import { STAGING_MODE } from "@/lib/env/staging";
import { buildAcceptanceMessage } from "./acceptance-proof";
import { renderProposalVia } from "./render";
import { selectPropostaTemplate } from "./template-select";
import { checkProposalReadiness } from "./clicksign-readiness";
import { plannedProposalCostCents } from "./cost";
import { prepareSend, type PrepareResult } from "./send";
import { withVendedorSendLock } from "./send-lock";
import { ensureProposalDefaultWitnesses } from "./witnesses";
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
  // Padronização de testemunhas da proposta (scope "proposta") ANTES da decisão
  // — materializa as padrão como ProposalSigner (idempotente) pra entrarem no
  // preflight/dedupe/envio. No-op quando a org não marcou testemunhas padrão.
  await ensureProposalDefaultWitnesses(proposalId);

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
    : (await selectPropostaTemplate(proposal.orgId, proposal.schemaType, proposal.dataJson))?.template ?? null;
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

interface EnvSignerSpec {
  role: string;
  name: string;
  email: string | null | undefined;
  cpf: string | null | undefined;
  phone: string | null | undefined;
  signingGroup: number;
  channel: string; // canal JÁ resolvido (email|whatsapp)
}

type SigSettings = Awaited<ReturnType<typeof getSignatureSettings>>;

/** Resolve placeholders da mensagem/assunto customizável da org. */
function fillPlaceholders(
  tpl: string | null | undefined,
  p: { proposalId: string; title: string; specs: EnvSignerSpec[] }
): string | null {
  if (!tpl) return null;
  const proponente = p.specs.find((s) => s.role !== "vendedor")?.name ?? "";
  const imovel = p.title.includes(" — ") ? p.title.split(" — ").slice(1).join(" — ") : "";
  return tpl
    .replace(/\{\{\s*numero\s*\}\}/g, p.proposalId.slice(-8))
    .replace(/\{\{\s*titulo\s*\}\}/g, p.title)
    .replace(/\{\{\s*proponente\s*\}\}/g, proponente)
    .replace(/\{\{\s*imovel\s*\}\}/g, imovel);
}

/**
 * CORE reusável: cria UM envelope ClickSign (`via`) com os signatários dados +
 * o PDF do `html`, roda a sequência v3 (create→addDocument→per-signer
 * addSigner+2 requirements→activate) e marca a row local `running`. Retry-safe
 * pelo `deleteMany(via, draft/failed)`. NÃO mexe no status da proposta — quem
 * chama decide (proponente = enviada; vendedor = via webhook). Lança em falha
 * (limpa o rascunho remoto + marca a row `failed`).
 */
async function runClickSignEnvelope(p: {
  proposalId: string;
  orgId: string;
  title: string;
  via: string;
  specs: EnvSignerSpec[];
  html: string;
  creds: ClickSignCreds;
  settings: SigSettings;
  deadlineAt: Date | null;
  costCents: number;
}): Promise<{ envelopeId: string }> {
  const pdf = await exportPdfToBuffer(p.html, "A4", null);
  const defaultAuth = (p.settings.defaultAuthMethod as AuthMethod) ?? "email";
  const rawName = `Proposta — ${p.title}${p.via === "reduzida" ? " (proprietário)" : ""}`;
  const name = STAGING_MODE ? `[STAGING] ${rawName}` : rawName;
  // Mensagem/assunto customizável da org, com placeholders resolvidos.
  const subject = fillPlaceholders(p.settings.proposalEmailSubject, p);
  const message = fillPlaceholders(p.settings.proposalEmailMessage, p);

  await prisma.envelope.deleteMany({
    where: { proposalId: p.proposalId, via: p.via, status: { in: ["draft", "failed"] } },
  });

  const envelope = await prisma.envelope.create({
    data: {
      proposalId: p.proposalId,
      orgId: p.orgId,
      source: "proposal",
      via: p.via,
      name,
      status: "draft",
      authMethod: defaultAuth,
      signers: {
        create: p.specs.map((s, i) => ({
          sourceKind: s.role === "vendedor" ? "vendedor" : "comprador",
          sourceIndex: i,
          role: clicksignRole(s.role),
          signingGroup: s.signingGroup,
          name: s.name,
          email: s.email ?? null,
          documentation: s.cpf ?? null,
          phone: toE164BR(s.phone) ?? null,
          notifyChannel: s.channel,
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
        autoClose: p.settings.autoClose,
        locale: p.settings.defaultLocale === "en-US" ? "en-US" : "pt-BR",
        deadlineAt: p.deadlineAt ?? undefined,
        defaultSubject: subject,
        defaultMessage: message,
      },
      p.creds
    );
    clicksignId = extractId(envResp);
    if (!clicksignId) throw new Error("Envelope sem id");

    const docResp = await addDocument(
      { envelopeId: clicksignId, filename: "proposta.pdf", contentBase64: pdf.toString("base64") },
      p.creds
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
          refusable: p.settings.refusable,
          group: local.signingGroup ?? undefined,
          notifyChannel: (local.notifyChannel as "email" | "whatsapp" | "sms") ?? "email",
        },
        p.creds
      );
      const signerId = extractId(sResp);
      if (!signerId) throw new Error("Signer sem id");

      // Auth coerente com o canal (whatsapp→whatsapp), com fallback pro padrão da
      // org se a ClickSign recusar (422) — sem derrubar o envelope por causa do auth.
      const preferredAuth = channelToAuth(local.notifyChannel, defaultAuth);
      let authReq;
      try {
        authReq = await addRequirement(
          { envelopeId: clicksignId, documentClicksignId, signerClicksignId: signerId, action: "provide_evidence", auth: preferredAuth },
          p.creds
        );
      } catch (e) {
        if (e instanceof ClicksignError && e.status === 422 && preferredAuth !== defaultAuth) {
          authReq = await addRequirement(
            { envelopeId: clicksignId, documentClicksignId, signerClicksignId: signerId, action: "provide_evidence", auth: defaultAuth },
            p.creds
          );
        } else {
          throw e;
        }
      }
      const signReq = await addRequirement(
        { envelopeId: clicksignId, documentClicksignId, signerClicksignId: signerId, action: "agree", role: (local.role as ClicksignRole) ?? "party" },
        p.creds
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

    await activateEnvelope(clicksignId, p.creds);

    await prisma.envelope.update({
      where: { id: envelope.id },
      data: {
        clicksignId,
        documentClicksignId,
        status: "running",
        sentAt: new Date(),
        costCents: p.costCents,
      },
    });
    await prisma.envelopeSigner.updateMany({
      where: { envelopeId: envelope.id, status: "pending" },
      data: { status: "notified", notifiedAt: new Date() },
    });
    return { envelopeId: envelope.id };
  } catch (err) {
    console.error("[proposals] falha no envio do envelope:", err);
    if (clicksignId) await deleteDraftEnvelope(clicksignId, p.creds).catch(() => {});
    await prisma.envelope.update({
      where: { id: envelope.id },
      data: { status: "failed", lastError: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

/**
 * 1º envelope: SÓ os proponentes (via completa). Os vendedores/proprietários,
 * se houver, entram num 2º envelope encadeado depois que os proponentes assinam
 * (sendVendedorEnvelope, disparado pelo webhook). Assim o proponente não espera
 * o dono, e o dono pode receber uma via com a comissão oculta.
 */
async function sendEnvelope(
  proposal: { id: string; orgId: string; title: string; validUntil: Date | null },
  decision: Extract<PrepareResult, { ok: true }>,
  html: string
): Promise<SendResult> {
  const settings = await getSignatureSettings(proposal.orgId);
  const specs: EnvSignerSpec[] = decision.signers.map((s, i) => ({
    role: s.role,
    name: s.name,
    email: s.email,
    cpf: s.cpf,
    phone: s.phone,
    signingGroup: s.signingGroup,
    channel: decision.resolvedChannels[i] ?? "email",
  }));
  const proponentes = specs.filter((s) => s.role !== "vendedor");
  const first = proponentes.length > 0 ? proponentes : specs; // fallback defensivo
  const costCents = plannedProposalCostCents({
    signerCount: first.length,
    costOverrides: settings.costOverridesJson as Record<string, unknown> | null,
  });

  const { envelopeId } = await runClickSignEnvelope({
    proposalId: proposal.id,
    orgId: proposal.orgId,
    title: proposal.title,
    via: "completa",
    specs: first,
    html,
    creds: decision.creds,
    settings,
    deadlineAt: proposal.validUntil ?? null,
    costCents,
  });

  await prisma.proposal.update({
    where: { id: proposal.id },
    data: { instrument: "envelope", sentAt: new Date(), reservedCostCents: decision.planCostCents },
  });
  await advanceProposalStatus(proposal.id, "enviada", { sentAt: new Date() });
  return { ok: true, instrument: "envelope", envelopeId };
}

/**
 * 2º envelope ENCADEADO do proprietário/vendedor — disparado quando o envelope
 * completo (proponentes) fecha e há signatários role="vendedor". Via física
 * "reduzida" (o webhook usa isso pra fechar a proposta em `completa`); o
 * CONTEÚDO é reduzido (comissão oculta) quando há `hiddenPaths`, senão completo.
 * Idempotente pelo `@@unique([proposalId, via])` + guard de existência.
 */
export type SendVendedorResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "already" // já enviado (running/closed) ou em voo — no-op idempotente
        | "not_found"
        | "no_vendedor"
        | "no_creds"
        | "preflight"
        | "budget"
        | "locked" // outro processo está enviando agora (lock)
        | "error";
      detail?: string;
    };

/**
 * Mapeia SendVendedorResult pra { status, body } HTTP. Compartilhado entre a
 * rota POST /send-vendedor (session) e o executor de intent PROPOSAL_SEND
 * com `via: "vendedor"` (bearer pós-aprovação). "already" é tratado como
 * sucesso (idempotente).
 */
export function vendedorResultToResponse(
  result: SendVendedorResult
): { status: number; body: Record<string, unknown> } {
  if (result.ok) return { status: 200, body: { ok: true } };
  switch (result.reason) {
    case "already":
      // Já enviado/em voo — idempotente, trata como sucesso.
      return { status: 200, body: { ok: true, already: true } };
    case "no_vendedor":
      return {
        status: 409,
        body: { error: "Esta proposta não tem vendedor/proprietário para acionar." },
      };
    case "no_creds":
      return {
        status: 422,
        body: { error: "Conta ClickSign não configurada para esta imobiliária." },
      };
    case "preflight":
      return {
        status: 422,
        body: {
          error:
            "Confira os dados do vendedor (nome completo, e-mail/telefone) e tente novamente.",
          detail: result.detail,
        },
      };
    case "budget":
      return {
        status: 402,
        body: {
          error:
            "Orçamento mensal de assinaturas atingido — libere saldo ou ajuste o limite em Configurações.",
        },
      };
    case "locked":
      return {
        status: 409,
        body: { error: "Envio ao vendedor já em andamento. Aguarde alguns segundos." },
      };
    case "not_found":
      return { status: 404, body: { error: "Proposta não encontrada." } };
    default:
      return {
        status: 502,
        body: { error: result.detail ?? "Falha ao enviar ao vendedor." },
      };
  }
}

export async function sendVendedorEnvelope(
  proposalId: string
): Promise<SendVendedorResult> {
  // Serializa com um lock distribuído: webhook (waitUntil) + botão + cron podem
  // disparar concorrentemente e a guarda de existência sozinha é TOCTOU (ambos
  // checam antes de qualquer draft existir). Lock ausente (sem Redis) → fail-open.
  return withVendedorSendLock(
    proposalId,
    () => sendVendedorEnvelopeLocked(proposalId),
    { ok: false, reason: "locked" }
  );
}

async function sendVendedorEnvelopeLocked(
  proposalId: string
): Promise<SendVendedorResult> {
  // Idempotência (2ª linha de defesa, dentro do lock): running/closed = já enviado;
  // draft RECENTE = em voo. Draft velho (tentativa que crashou) NÃO bloqueia —
  // runClickSignEnvelope limpa draft/failed e recria.
  const inFlightCutoff = new Date(Date.now() - 5 * 60_000);
  const existing = await prisma.envelope.findFirst({
    where: {
      proposalId,
      via: "reduzida",
      OR: [
        { status: { in: ["running", "closed"] } },
        { status: "draft", createdAt: { gt: inFlightCutoff } },
      ],
    },
    select: { id: true },
  });
  if (existing) return { ok: false, reason: "already" };

  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) return { ok: false, reason: "not_found" };

  const rows = await prisma.proposalSigner.findMany({
    where: { proposalId, included: true, role: "vendedor" },
    orderBy: { signingGroup: "asc" },
  });
  if (rows.length === 0) return { ok: false, reason: "no_vendedor" };

  const creds = await resolveClickSignCreds(proposal.orgId);
  if (!creds) {
    await logProposalEvent(proposalId, "chained_envelope2_no_creds");
    return { ok: false, reason: "no_creds" };
  }
  const settings = await getSignatureSettings(proposal.orgId);

  // Canal por vendedor RESOLVIDO antes do preflight: whatsapp só se a conta é Plus
  // e há telefone; senão email. Validar contra o canal cru (r.notifyChannel)
  // deixava passar um vendedor whatsapp-só-telefone (sem e-mail); rebaixado pra
  // email ele geraria envelope sem endereço → ClickSign 422 → proposta travada em
  // aguardando_vendedor (o reconcile re-tentaria com a mesma falha).
  const plus = settings.whatsappSignatureAvailable ?? false;
  const specs: EnvSignerSpec[] = rows.map((r) => ({
    role: "vendedor",
    name: r.name,
    email: r.email,
    cpf: r.cpf,
    phone: r.phone,
    signingGroup: r.signingGroup,
    channel: r.notifyChannel === "whatsapp" && plus && r.phone ? "whatsapp" : "email",
  }));

  // Preflight dos vendedores contra o canal RESOLVIDO (nome/CPF/telefone/e-mail).
  // Falhou → registra e para (o operador corrige o contato e o /sync re-dispara).
  // Não gasta.
  const issues = checkProposalReadiness(
    specs.map((s) => ({ name: s.name, email: s.email, cpf: s.cpf, phone: s.phone, notifyChannel: s.channel }))
  );
  if (issues.length > 0) {
    await logProposalEvent(proposalId, "chained_envelope2_preflight_failed", { issues });
    // issues são objetos ReadinessIssue — extrai a razão legível (senão o detail
    // vira "[object Object]" no 422 que o operador/cron lê).
    return { ok: false, reason: "preflight", detail: issues.map((i) => i.reason).join("; ") };
  }

  // Conteúdo: reduzida (comissão oculta) quando há hiddenPaths; senão completa.
  const contentVia = proposal.hiddenPaths.length > 0 ? "reduzida" : "completa";
  const tpl = proposal.templateId
    ? await prisma.contractTemplate.findUnique({ where: { id: proposal.templateId } })
    : (await selectPropostaTemplate(proposal.orgId, proposal.schemaType, proposal.dataJson))?.template ?? null;
  const dataJson = (proposal.dataJson ?? {}) as Record<string, unknown>;
  const html = tpl?.handlebarsSource
    ? renderProposalVia({
        templateSource: tpl.handlebarsSource,
        schemaType: proposal.schemaType,
        dataJson,
        hiddenPaths: proposal.hiddenPaths,
        via: contentVia,
        numero: proposal.id.slice(-8),
        comissaoIncluida: proposal.comissaoIncluida,
      })
    : (proposal.sentSnapshotHtml ?? `<h1>${proposal.title}</h1>`);

  const costCents = plannedProposalCostCents({
    signerCount: specs.length,
    costOverrides: settings.costOverridesJson as Record<string, unknown> | null,
  });

  // Budget mensal (mesmo cap do envio inicial em send.ts): o split enviou só os
  // proponentes primeiro, então o custo do vendedor NÃO foi contado adiantado. Sem
  // este gate, o 2º envelope estouraria o teto que a plataforma promete (402). Sub-
  // teto de propostas tem precedência sobre o mensal. Estourou → registra e para
  // (o reconcile re-tenta quando houver saldo; a proposta fica em aguardando_vendedor).
  const budgetCents =
    settings.proposalBudgetCents ?? getMonthlyBudgetCents(settings.monthlyBudgetCents);
  const spentCents = await getMonthlySpendCents(proposal.orgId);
  if (spentCents + costCents > budgetCents) {
    await logProposalEvent(proposalId, "chained_envelope2_budget_exceeded", {
      spentCents,
      budgetCents,
      costCents,
    });
    return { ok: false, reason: "budget" };
  }

  try {
    await runClickSignEnvelope({
      proposalId,
      orgId: proposal.orgId,
      title: proposal.title,
      via: "reduzida",
      specs,
      html,
      creds,
      settings,
      deadlineAt: proposal.validUntil ?? null,
      costCents,
    });
    await logProposalEvent(proposalId, "chained_envelope2_sent");
    return { ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await logProposalEvent(proposalId, "chained_envelope2_failed", { error: detail });
    return { ok: false, reason: "error", detail };
  }
}

async function logProposalEvent(
  proposalId: string,
  eventName: string,
  payload?: Record<string, unknown>
): Promise<void> {
  await prisma.proposalEvent
    .create({
      data: {
        proposalId,
        eventName,
        source: "system",
        ...(payload ? { payload: payload as never } : {}),
      },
    })
    .catch(() => {});
}
