import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { exportPdfToBuffer } from "@/lib/render/exporter";
import { loadOrgDocumentStyleExport } from "@/lib/render/org-document-style";
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
import { normalizeSigningGroups } from "@/lib/clicksign/signing-groups";
import { STAGING_MODE } from "@/lib/env/staging";
import { buildAcceptanceMessage } from "./acceptance-proof";
import { proposalPublicLink } from "./public-link";
import { renderProposalVia } from "./render";
import { selectPropostaTemplate } from "./template-select";
import { checkProposalReadiness } from "./clicksign-readiness";
import { plannedProposalCostCents, plannedAcceptanceCostCents } from "./cost";
import { prepareSend, type PrepareResult } from "./send";
import { withVendedorSendLock } from "./send-lock";
import { ensureProposalDefaultWitnesses } from "./witnesses";
import { advanceProposalStatus } from "./status";
import { proposalNumero } from "./code";
import { summarizeProposalData } from "./summarize";
import { SEND_VENDEDOR_STATUSES } from "./status-sets";
import { notifyProposalMilestone } from "./notify-proposal";
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
  | {
      ok: true;
      instrument: "envelope" | "aceite";
      envelopeId?: string;
      /** Avisos do roteamento (ex.: "foi por Aceite, não assinatura"). A UI
       *  MOSTRA — antes eram computados em routing.ts e descartados aqui. */
      warnings?: string[];
      /** Roteou sem medir a capacidade da conta ClickSign. */
      capabilitiesUnverified?: boolean;
    }
  | { ok: false; block: PrepareResult };

/** Mapeia o bloqueio do prepareSend pra HTTP + corpo acionável na UI. */
export function blockToResponse(block: PrepareResult): { status: number; body: unknown } {
  if ("ok" in block) return { status: 500, body: { error: "estado inesperado" } };
  switch (block.blocked) {
    case "preflight": {
      // `error: "preflight"` sozinho é um código, não uma explicação — quem
      // recebe só isso inventa a causa. `message` diz DE QUEM é cada pendência.
      const nome = (i: { signerIndex: number }) =>
        block.signers?.[i.signerIndex]?.name?.trim() || `Signatário ${i.signerIndex + 1}`;
      const message = block.issues
        .map((i) => {
          const texto = `${i.reason}${i.hint ? ` (${i.hint})` : ""}`;
          // Pendência do documento não pertence a signatário nenhum — prefixar
          // com "Signatário 0" mandaria o leitor procurar a pessoa errada, que
          // é exatamente o erro que este bloco existe pra não repetir.
          return i.signerIndex < 0 ? texto : `${nome(i)}: ${texto}`;
        })
        .join(" ");
      return { status: 422, body: { error: "preflight", message, issues: block.issues } };
    }
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
      return result;
    }
    // Repassa os avisos da DECISÃO pro caller. Sem isto o corretor envia uma
    // proposta por Aceite achando que foi pra assinatura — foi o que aconteceu.
    return {
      ...result,
      ...(decision.warnings.length > 0 ? { warnings: decision.warnings } : {}),
      ...(decision.capabilitiesUnverified ? { capabilitiesUnverified: true } : {}),
    };
  } catch (err) {
    await releaseClaim(proposalId);
    throw err;
  }
}

/**
 * Devolve o status pra "falha_envio" quando o claim foi feito mas o envio não
 * completou. Exportado pro cron reconcile recuperar claims ÓRFÃOS: função
 * morta por timeout depois do claim nunca chega ao catch daqui, e a proposta
 * fica eterna em "enviada" sem envelope — /send responde "já foi enviada" e
 * /remind "ninguém pendente".
 */
export async function releaseClaim(proposalId: string): Promise<void> {
  await prisma.proposal
    .updateMany({
      where: { id: proposalId, status: "enviada" },
      data: { status: "falha_envio" },
    })
    .catch(() => {});
}

/**
 * Recupera um claim órfão (cron reconcile): libera pro estado reenviável e
 * registra o evento pro operador entender por que a proposta "voltou".
 */
export async function recoverOrphanClaim(proposalId: string): Promise<void> {
  await releaseClaim(proposalId);
  await logProposalEvent(proposalId, "send_claim_recovered", {
    reason: "envio interrompido (timeout?) — sem envelope ativo nem aceite; liberado pra reenvio",
  });
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
        numero: proposalNumero(proposal),
        comissaoIncluida: proposal.comissaoIncluida,
        meta: { emitidaEm: proposal.createdAt, validaAte: proposal.validUntil },
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
  proposal: {
    id: string;
    orgId: string;
    title: string;
    token: string;
    code: string | null;
  },
  decision: Extract<PrepareResult, { ok: true }>,
  _html: string
): Promise<SendResult> {
  const link = proposalPublicLink(proposal.token);
  const numero = proposalNumero(proposal);

  // Carrega as linhas pra rastrear o acceptance_term POR signatário. Retry-safe:
  // um signatário que já tem acceptanceClicksignId não é reenviado (senão o
  // retry após falha parcial duplicaria termos vinculantes + cobrança).
  const rows = await prisma.proposalSigner.findMany({
    where: { proposalId: proposal.id, included: true },
  });

  let proponenteAcceptanceId: string | null = null;
  let termsCreated = 0;
  let termsPresent = 0; // criados agora + pré-existentes (retry)

  // Paridade com o envelope (2026-08): o envio INICIAL não manda termo pro
  // VENDEDOR — a 2ª rodada dele passa pela parada de decisão
  // (sendVendedorAceite). Fallback defensivo: se o filtro zerar a lista
  // (proposta atípica só com vendedores), manda a todos como antes — nunca
  // deixar o envio sem nenhum termo.
  const nonVendedor = decision.signers.filter(
    (s) => matchSignerRow(rows, s)?.role !== "vendedor"
  );
  const targets = nonVendedor.length > 0 ? nonVendedor : decision.signers;

  for (const s of targets) {
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
  p: {
    numero: string;
    title: string;
    imovel: string | null;
    specs: EnvSignerSpec[];
  }
): string | null {
  if (!tpl) return null;
  const proponente = p.specs.find((s) => s.role !== "vendedor")?.name ?? "";
  // `imovel` vem resolvido do dataJson. Antes era extraído fatiando o título no
  // " — ", o que só funcionava enquanto o título era SEMPRE derivado
  // ("proponente — endereço"). Com título livre, esse split devolvia um pedaço
  // arbitrário do texto do corretor como se fosse o endereço do imóvel.
  const imovel = p.imovel ?? "";
  return tpl
    .replace(/\{\{\s*numero\s*\}\}/g, p.numero)
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
  /** Código da proposta (`proposalNumero`) — placeholder `{{numero}}`. */
  numero: string;
  /** Endereço do imóvel resolvido do dataJson — placeholder `{{imovel}}`. */
  imovel: string | null;
  via: string;
  specs: EnvSignerSpec[];
  html: string;
  creds: ClickSignCreds;
  settings: SigSettings;
  deadlineAt: Date | null;
  costCents: number;
}): Promise<{ envelopeId: string }> {
  // Mesmo leiaute do PDF de contrato (DocumentStyle default da org). Sem preset
  // volta ao clássico — `null` continua sendo o fallback.
  const style = await loadOrgDocumentStyleExport(p.orgId);
  const pdf = await exportPdfToBuffer(p.html, "A4", style);
  const defaultAuth = (p.settings.defaultAuthMethod as AuthMethod) ?? "email";
  const rawName = `Proposta — ${p.title}${p.via === "reduzida" ? " (proprietário)" : ""}`;
  const name = STAGING_MODE ? `[STAGING] ${rawName}` : rawName;
  // Mensagem/assunto customizável da org, com placeholders resolvidos.
  const subject = fillPlaceholders(p.settings.proposalEmailSubject, p);
  const message = fillPlaceholders(p.settings.proposalEmailMessage, p);

  // `canceled` entrou no cleanup (bug D): uma 2ª via expirada/cancelada na
  // ClickSign deixava a row `canceled` pra sempre e o recriar estourava o
  // @@unique([proposalId, via]) (P2002). Antes de apagar, o id remoto vai pra
  // um ProposalEvent — é o rastro de auditoria do envelope substituído.
  const replaced = await prisma.envelope.findMany({
    where: {
      proposalId: p.proposalId,
      via: p.via,
      status: { in: ["draft", "failed", "canceled"] },
      clicksignId: { not: null },
    },
    select: { id: true, clicksignId: true, status: true },
  });
  if (replaced.length > 0) {
    await prisma.proposalEvent
      .create({
        data: {
          proposalId: p.proposalId,
          eventName: "envelope_replaced",
          source: "system",
          payload: { via: p.via, replaced },
        },
      })
      .catch(() => {});
  }
  await prisma.envelope.deleteMany({
    where: {
      proposalId: p.proposalId,
      via: p.via,
      status: { in: ["draft", "failed", "canceled"] },
    },
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

  // Normaliza os grupos ENVIADOS à ClickSign pra 1..n contíguos POR ENVELOPE.
  // O DB mantém a semântica de negócio (1=proponente, 2=vendedor/testemunha),
  // mas a ClickSign só notifica o grupo N depois que o N-1 assina — um envelope
  // só com grupo 2 (a via "reduzida" do vendedor) não tem grupo 1 pra destravar
  // e NINGUÉM é notificado na ativação (só um reenvio manual, que ignora o
  // gate, alcançava o signatário). Mesmo padrão do executor de contratos.
  const clicksignGroupFor = normalizeSigningGroups(
    envelope.signers.map((s) => s.signingGroup)
  );

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
          group: clicksignGroupFor(local.signingGroup),
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
  proposal: {
    id: string;
    orgId: string;
    title: string;
    code: string | null;
    kind: string;
    dataJson: unknown;
    validUntil: Date | null;
  },
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
    numero: proposalNumero(proposal),
    imovel: summarizeProposalData(proposal.dataJson, proposal.kind).imovel,
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
  | {
      ok: true;
      /** Nada foi enviado: a proposta legada foi fechada em `completa`
       *  (todos os vendedores já tinham aceitado o termo da 1ª rodada). */
      reconciled?: "completa";
    }
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
        | "wrong_status" // guard anti-double-charge: status fora de SEND_VENDEDOR_STATUSES
        | "error";
      detail?: string;
    };

/** De onde veio a chamada — decide notificação (manual já vê o resultado). */
export type SendVendedorOrigin = "manual" | "cron" | "webhook";

/**
 * Mapeia SendVendedorResult pra { status, body } HTTP. Compartilhado entre a
 * rota POST /send-vendedor (session) e o executor de intent PROPOSAL_SEND
 * com `via: "vendedor"` (bearer pós-aprovação). "already" é tratado como
 * sucesso (idempotente).
 */
export function vendedorResultToResponse(
  result: SendVendedorResult
): { status: number; body: Record<string, unknown> } {
  if (result.ok) {
    return result.reconciled
      ? { status: 200, body: { ok: true, reconciled: result.reconciled } }
      : { status: 200, body: { ok: true } };
  }
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
    case "wrong_status":
      return {
        status: 409,
        body: {
          error:
            "A proposta não está no ponto de enviar a via do proprietário (o proponente precisa ter assinado).",
          detail: result.detail,
        },
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
  proposalId: string,
  origin: SendVendedorOrigin = "manual"
): Promise<SendVendedorResult> {
  // Serializa com um lock distribuído: webhook (waitUntil) + botão + cron podem
  // disparar concorrentemente e a guarda de existência sozinha é TOCTOU (ambos
  // checam antes de qualquer draft existir). Lock ausente (sem Redis) → fail-open.
  return withVendedorSendLock(
    proposalId,
    () => sendVendedorEnvelopeLocked(proposalId, origin),
    { ok: false, reason: "locked" }
  );
}

/**
 * Dispatcher da 2ª via por INSTRUMENTO da proposta. TODOS os callers (rota,
 * executor de intent, cron reconcile, webhook) passam por aqui — é o único
 * lugar que sabe se a 2ª rodada vai por envelope ou por Aceite WhatsApp.
 * O braço de Aceite entra na paridade (PR 2.5); até lá, registra e falha
 * visível em vez de mandar um envelope pra uma jornada de Aceite.
 */
export async function sendVendedorVia(
  proposalId: string,
  origin: SendVendedorOrigin
): Promise<SendVendedorResult> {
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: { instrument: true },
  });
  if (!proposal) return { ok: false, reason: "not_found" };
  if (proposal.instrument === "aceite") {
    return withVendedorSendLock(
      proposalId,
      () => sendVendedorAceiteLocked(proposalId, origin),
      { ok: false, reason: "locked" }
    );
  }
  return sendVendedorEnvelope(proposalId, origin);
}

/**
 * 2ª rodada do ACEITE (WhatsApp): manda o termo pros vendedores/proprietários,
 * espelhando sendVendedorEnvelopeLocked — lock (no dispatcher), guard de
 * status anti-double-charge, preflight, budget (plannedAcceptanceCostCents),
 * avanço pra aguardando_vendedor SÓ no sucesso e eventos chained_aceite2_*.
 * Idempotência POR LINHA via `ProposalSigner.acceptanceClicksignId @unique`
 * (linha com termo não é reenviada — retry não duplica cobrança).
 */
async function sendVendedorAceiteLocked(
  proposalId: string,
  origin: SendVendedorOrigin
): Promise<SendVendedorResult> {
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) return { ok: false, reason: "not_found" };

  if (!SEND_VENDEDOR_STATUSES.has(proposal.status)) {
    await logProposalEvent(proposalId, "chained_aceite2_wrong_status", {
      status: proposal.status,
      origin,
    });
    return { ok: false, reason: "wrong_status", detail: `status atual: ${proposal.status}` };
  }

  const rows = await prisma.proposalSigner.findMany({
    where: { proposalId, included: true, role: "vendedor" },
    orderBy: { signingGroup: "asc" },
  });
  if (rows.length === 0) return { ok: false, reason: "no_vendedor" };

  // "Pendente" = sem termo OU com termo MORTO (expired/canceled): esses precisam
  // de reemissão — "tem id ⇒ enviado" tratava termo expirado como sucesso e
  // travava a proposta em aguardando_vendedor pra sempre. `refused` fica fora:
  // é desfecho legítimo, tratado pelo webhook (recusada_*), nunca reemitido.
  const DEAD_ACCEPTANCE = new Set(["expired", "canceled"]);
  const pending = rows.filter(
    (r) => !r.acceptanceClicksignId || DEAD_ACCEPTANCE.has(r.acceptanceStatus ?? "")
  );
  if (pending.length === 0) {
    // Reconciliação do legado (pré-de9f441e o vendedor recebia termo já na 1ª
    // rodada): se TODOS os vendedores já completaram, a proposta está feita —
    // fechar em `completa` (espelho do fechamento do webhook em
    // acceptance-webhook.ts), não estacionar em aguardando_vendedor, o que
    // fechava a escotilha "concluir sem enviar" e alimentava o cron pra sempre.
    if (rows.every((r) => r.acceptanceStatus === "completed")) {
      const adv = await advanceProposalStatus(proposalId, "completa", {
        completedAt: new Date(),
      });
      if (adv.moved) {
        await logProposalEvent(proposalId, "chained_aceite2_reconciled_completa", { origin });
        await notifyProposalMilestone({
          proposalId,
          orgId: proposal.orgId,
          userId: proposal.userId,
          kind: "completed",
        }).catch(() => {});
        return { ok: true, reconciled: "completa" };
      }
      // CAS não moveu: replay (já está completa) é idempotente; qualquer outro
      // caso é um writer concorrente que levou a proposta pra outro estado —
      // dizer "reconciliada" aqui mentiria pro operador.
      if (adv.reason === "replay") return { ok: false, reason: "already" };
      return {
        ok: false,
        reason: "wrong_status",
        detail: `status atual: ${adv.reason === "illegal" ? adv.from : "desconhecido"}`,
      };
    }
    // Todos os termos vivos (sent) — retry/replay, garante o status e sai
    // idempotente.
    await advanceProposalStatus(proposalId, "aguardando_vendedor");
    return { ok: false, reason: "already" };
  }

  const notifyFailure = (reason: string) =>
    notifyProposalMilestone({
      proposalId,
      orgId: proposal.orgId,
      userId: proposal.userId,
      kind: "vendedor_send_failed",
      dedupeSuffix: `aceite:${reason}`,
    }).catch(() => {});

  const creds = await resolveClickSignCreds(proposal.orgId);
  if (!creds) {
    await logProposalEvent(proposalId, "chained_aceite2_no_creds");
    await notifyFailure("no_creds");
    return { ok: false, reason: "no_creds" };
  }
  const settings = await getSignatureSettings(proposal.orgId);

  // Preflight: Aceite é 100% WhatsApp — telefone nacional válido + nome completo.
  const issues = checkProposalReadiness(
    pending.map((r) => ({
      name: r.name,
      email: r.email,
      cpf: r.cpf,
      phone: r.phone,
      notifyChannel: "whatsapp",
    }))
  );
  if (issues.length > 0) {
    await logProposalEvent(proposalId, "chained_aceite2_preflight_failed", { issues });
    await notifyFailure("preflight");
    return { ok: false, reason: "preflight", detail: issues.map((i) => i.reason).join("; ") };
  }

  // Budget: custo do Aceite (~R$0,99/termo, cobrado na entrega) — mesmo gate
  // do envelope, com o custo do instrumento certo.
  const costCents = plannedAcceptanceCostCents(pending.length);
  const budgetCents =
    settings.proposalBudgetCents ?? getMonthlyBudgetCents(settings.monthlyBudgetCents);
  const spentCents = await getMonthlySpendCents(proposal.orgId);
  if (spentCents + costCents > budgetCents) {
    await logProposalEvent(proposalId, "chained_aceite2_budget_exceeded", {
      spentCents,
      budgetCents,
      costCents,
    });
    await notifyFailure("budget");
    return { ok: false, reason: "budget" };
  }

  const link = proposalPublicLink(proposal.token);
  const numero = proposalNumero(proposal);
  let created = 0;
  let lastError: string | null = null;
  for (const row of pending) {
    const phone = toClicksignPhone(row.phone) ?? "";
    if (!phone) continue; // preflight já barrou; defensivo
    try {
      const message = buildAcceptanceMessage({ numero, title: proposal.title, link });
      const resp = await createAcceptanceWhatsapp(
        { title: `Proposta ${numero}`, message, signerName: row.name, signerPhone: phone },
        creds
      );
      const acceptanceId = extractId(resp);
      if (acceptanceId) {
        // Reemissão sobrescreve o id do termo morto — registra o antigo antes,
        // senão a trilha do termo original some junto.
        if (row.acceptanceClicksignId) {
          await logProposalEvent(proposalId, "aceite2_term_reissued", {
            signerId: row.id,
            previousAcceptanceId: row.acceptanceClicksignId,
            previousStatus: row.acceptanceStatus,
          });
        }
        await prisma.proposalSigner.update({
          where: { id: row.id },
          data: { acceptanceClicksignId: acceptanceId, acceptanceStatus: "sent" },
        });
        created++;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[proposals] Aceite 2ª via falhou pro signatário ${row.id}:`, err);
    }
  }

  if (created === 0) {
    await logProposalEvent(proposalId, "chained_aceite2_failed", { error: lastError });
    await notifyFailure("error");
    return { ok: false, reason: "error", detail: lastError ?? "Nenhum termo criado." };
  }

  // Sucesso (≥1 termo criado; os que falharam ficam pro retry — a idempotência
  // por linha garante que só os pendentes são reenviados).
  await advanceProposalStatus(proposalId, "aguardando_vendedor");
  await logProposalEvent(proposalId, "chained_aceite2_sent", { created, origin });
  if (origin !== "manual") {
    await notifyProposalMilestone({
      proposalId,
      orgId: proposal.orgId,
      userId: proposal.userId,
      kind: "vendedor_sent",
    }).catch(() => {});
  }
  if (created < pending.length) {
    await notifyFailure("parcial");
    return {
      ok: false,
      reason: "error",
      detail: `Termos criados: ${created}/${pending.length} — reenvie para completar.`,
    };
  }
  return { ok: true };
}

async function sendVendedorEnvelopeLocked(
  proposalId: string,
  origin: SendVendedorOrigin
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

  // Guard ANTI-DOUBLE-CHARGE por status (2026-08): antes não havia NENHUM guard
  // de status aqui — o guard vivia só na rota, e webhook/cron chamavam sem ele.
  // Com o lock fail-open (Redis fora), um replay de webhook numa proposta já
  // completa/cancelada criava um 2º envelope real (R$/signer). O CAS do status
  // não protege: esta função hoje avança DEPOIS de gastar.
  if (!SEND_VENDEDOR_STATUSES.has(proposal.status)) {
    await logProposalEvent(proposalId, "chained_envelope2_wrong_status", {
      status: proposal.status,
      origin,
    });
    return { ok: false, reason: "wrong_status", detail: `status atual: ${proposal.status}` };
  }

  const rows = await prisma.proposalSigner.findMany({
    where: { proposalId, included: true, role: "vendedor" },
    orderBy: { signingGroup: "asc" },
  });
  if (rows.length === 0) return { ok: false, reason: "no_vendedor" };

  // Sino de falha da 2ª via — o buraco operacional que o plano fecha: a falha
  // só existia como ProposalEvent que ninguém abria. Dedupe por motivo
  // (batchId proposal:{id}:vendedor_send_failed:{reason}).
  const notifyFailure = (reason: string) =>
    notifyProposalMilestone({
      proposalId,
      orgId: proposal.orgId,
      userId: proposal.userId,
      kind: "vendedor_send_failed",
      dedupeSuffix: reason,
    }).catch(() => {});

  const creds = await resolveClickSignCreds(proposal.orgId);
  if (!creds) {
    await logProposalEvent(proposalId, "chained_envelope2_no_creds");
    await notifyFailure("no_creds");
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
    await notifyFailure("preflight");
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
        numero: proposalNumero(proposal),
        comissaoIncluida: proposal.comissaoIncluida,
        meta: { emitidaEm: proposal.createdAt, validaAte: proposal.validUntil },
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
    await notifyFailure("budget");
    return { ok: false, reason: "budget" };
  }

  // Prazo PRÓPRIO da 2ª via (bug C): a via do proprietário nascia com
  // deadline = validUntil, que na parada de decisão (dias parada) já podia
  // estar VENCIDO — o envelope nascia expirado. Agora: o que for MAIOR entre a
  // validade da proposta e hoje + prazo da org (default 7 dias).
  const ownerDays = settings.proposalOwnerDeadlineDays ?? 7;
  const minDeadline = new Date(Date.now() + ownerDays * 86_400_000);
  const vendedorDeadlineAt =
    proposal.validUntil && proposal.validUntil > minDeadline
      ? proposal.validUntil
      : minDeadline;

  try {
    await runClickSignEnvelope({
      proposalId,
      orgId: proposal.orgId,
      title: proposal.title,
      numero: proposalNumero(proposal),
      imovel: summarizeProposalData(proposal.dataJson, proposal.kind).imovel,
      via: "reduzida",
      specs,
      html,
      creds,
      settings,
      deadlineAt: vendedorDeadlineAt,
      costCents,
    });
    // Avanço DEPOIS do sucesso (antes o webhook avançava antes de gastar):
    // falha por budget/preflight/erro deixa a proposta na parada de decisão,
    // com o botão de reenvio na tela. No retry a partir de aguardando_vendedor
    // o advance é replay (no-op) — o CAS protege.
    await advanceProposalStatus(proposalId, "aguardando_vendedor");
    await prisma.proposal.update({
      where: { id: proposalId },
      data: { vendedorDeadlineAt },
    });
    await logProposalEvent(proposalId, "chained_envelope2_sent", { origin });
    if (origin !== "manual") {
      // Quem clicou no botão já viu o resultado; webhook/cron avisam pelo sino.
      await notifyProposalMilestone({
        proposalId,
        orgId: proposal.orgId,
        userId: proposal.userId,
        kind: "vendedor_sent",
      }).catch(() => {});
    }
    return { ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await logProposalEvent(proposalId, "chained_envelope2_failed", { error: detail });
    await notifyFailure("error");
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
