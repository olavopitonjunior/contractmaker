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
import { buildAcceptanceMessage } from "./acceptance-proof";
import { renderProposalVia } from "./render";
import { selectPropostaTemplate } from "./template-select";
import { prepareSend, type PrepareResult } from "./send";
import { advanceProposalStatus } from "./status";
import { toE164BR } from "./clicksign-readiness";
import type { ClicksignRole } from "@/lib/clicksign/roles";

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

  if (decision.instrument === "aceite") {
    return sendAceite(proposal, decision, html);
  }
  return sendEnvelope(proposal, decision, html);
}

async function sendAceite(
  proposal: { id: string; orgId: string; title: string; token: string },
  decision: Extract<PrepareResult, { ok: true }>,
  _html: string
): Promise<SendResult> {
  const link = `${process.env.NEXTAUTH_URL ?? "https://staging.imobpro.ia.br"}/p/${proposal.token}`;
  const numero = proposal.id.slice(-8);
  let firstId: string | null = null;
  for (const s of decision.signers) {
    const phone = toE164BR(s.phone)?.replace("+", "") ?? "";
    if (!phone) continue;
    const message = buildAcceptanceMessage({ numero, title: proposal.title, link });
    const resp = await createAcceptanceWhatsapp(
      {
        title: `Proposta ${numero}`,
        message,
        signerName: s.name,
        signerPhone: phone,
      },
      decision.creds
    );
    firstId = firstId ?? extractId(resp);
  }
  await prisma.proposal.update({
    where: { id: proposal.id },
    data: {
      instrument: "aceite",
      acceptanceClicksignId: firstId,
      sentAt: new Date(),
      reservedCostCents: decision.planCostCents,
    },
  });
  await advanceProposalStatus(proposal.id, "enviada", { sentAt: new Date() });
  return { ok: true, instrument: "aceite" };
}

async function sendEnvelope(
  proposal: { id: string; orgId: string; title: string },
  decision: Extract<PrepareResult, { ok: true }>,
  html: string
): Promise<SendResult> {
  const pdf = await exportPdfToBuffer(html, "A4", null);

  // Row local (draft) + signers.
  const envelope = await prisma.envelope.create({
    data: {
      proposalId: proposal.id,
      orgId: proposal.orgId,
      source: "proposal",
      via: "completa",
      name: `Proposta — ${proposal.title}`,
      status: "draft",
      authMethod: "email",
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
      { name: envelope.name, autoClose: true, locale: "pt-BR" },
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
          phoneNumber: local.phone ?? undefined,
          hasDocumentation: Boolean(local.documentation),
          group: local.signingGroup ?? undefined,
          notifyChannel: (local.notifyChannel as "email" | "whatsapp" | "sms") ?? "email",
        },
        decision.creds
      );
      const signerId = extractId(sResp);
      if (!signerId) throw new Error("Signer sem id");
      const authReq = await addRequirement(
        { envelopeId: clicksignId, documentClicksignId, signerClicksignId: signerId, action: "provide_evidence", auth: "email" },
        decision.creds
      );
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
