import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  addRequirement,
  addSigner,
  notifySigner,
  removeSigner,
  updateSigner,
} from "./envelopes";
import { ClicksignError } from "./client";
import { resolveClickSignCreds } from "./account";
import type { ClicksignRole } from "./roles";
import type { AuthMethod } from "./types";

export const RESEND_COOLDOWN_MS = 60 * 60 * 1000; // 1h
export const MAX_RESENDS = 5;

type SignerWithEnvelope = Prisma.EnvelopeSignerGetPayload<{
  include: { envelope: true };
}>;
type Envelope = Prisma.EnvelopeGetPayload<object>;
type Signer = Prisma.EnvelopeSignerGetPayload<object>;

/** Resultado uniforme — a rota traduz pra NextResponse (sucesso ou erro+status). */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

/** Reenvia a notificação de assinatura (com cooldown + limite). */
export async function resendSignerAction(
  signer: SignerWithEnvelope
): Promise<ActionResult<Signer>> {
  if (signer.status === "signed" || signer.status === "removed") {
    return { ok: false, status: 400, error: "Signatário não pode ser reenviado neste estado" };
  }
  if (signer.resendCount >= MAX_RESENDS) {
    return { ok: false, status: 429, error: `Limite de ${MAX_RESENDS} reenvios atingido` };
  }
  if (
    signer.lastResendAt &&
    Date.now() - signer.lastResendAt.getTime() < RESEND_COOLDOWN_MS
  ) {
    const wait = Math.ceil(
      (RESEND_COOLDOWN_MS - (Date.now() - signer.lastResendAt.getTime())) / 60000
    );
    return { ok: false, status: 429, error: `Aguarde ${wait} min antes de reenviar` };
  }

  const creds = await resolveClickSignCreds(signer.envelope.orgId);
  if (signer.envelope.clicksignId && signer.clicksignId && creds) {
    try {
      await notifySigner(signer.envelope.clicksignId, signer.clicksignId, creds);
    } catch (err) {
      if (err instanceof ClicksignError) {
        return { ok: false, status: 502, error: `Clicksign: ${err.message}` };
      }
      throw err;
    }
  }

  const updated = await prisma.envelopeSigner.update({
    where: { id: signer.id },
    data: {
      resendCount: { increment: 1 },
      lastResendAt: new Date(),
      ...(signer.status === "pending"
        ? { status: "notified", notifiedAt: new Date() }
        : {}),
    },
  });
  return { ok: true, data: updated };
}

export interface SignerUpdate {
  name?: string;
  email?: string;
  documentation?: string;
  phone?: string;
}

/** Edita nome/email/documento/telefone de um signatário ainda não assinado. */
export async function updateSignerAction(
  signer: SignerWithEnvelope,
  updates: SignerUpdate
): Promise<ActionResult<Signer>> {
  if (signer.status === "signed" || signer.status === "removed") {
    return { ok: false, status: 400, error: "Signatário não pode ser editado neste estado" };
  }
  const envStatus = signer.envelope.status;
  if (envStatus !== "draft" && envStatus !== "running") {
    return { ok: false, status: 400, error: "Envelope não permite edição neste estado" };
  }
  if (
    updates.name === undefined &&
    updates.email === undefined &&
    updates.documentation === undefined &&
    updates.phone === undefined
  ) {
    return { ok: false, status: 400, error: "Nenhum campo informado" };
  }

  const creds = await resolveClickSignCreds(signer.envelope.orgId);
  if (signer.envelope.clicksignId && signer.clicksignId && creds) {
    try {
      await updateSigner(
        {
          envelopeId: signer.envelope.clicksignId,
          signerId: signer.clicksignId,
          name: updates.name,
          email: updates.email,
          documentation: updates.documentation,
          phoneNumber: updates.phone,
        },
        creds
      );
    } catch (err) {
      if (err instanceof ClicksignError) {
        return { ok: false, status: 502, error: `Clicksign: ${err.message}` };
      }
      throw err;
    }
  }

  const updated = await prisma.envelopeSigner.update({
    where: { id: signer.id },
    data: {
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.email !== undefined ? { email: updates.email } : {}),
      ...(updates.documentation !== undefined
        ? { documentation: updates.documentation || null }
        : {}),
      ...(updates.phone !== undefined ? { phone: updates.phone || null } : {}),
    },
  });
  return { ok: true, data: updated };
}

/** Remove (soft) um signatário que ainda não assinou. */
export async function removeSignerAction(
  signer: SignerWithEnvelope
): Promise<ActionResult<true>> {
  if (signer.status === "signed") {
    return { ok: false, status: 400, error: "Signatário já assinou — não pode ser removido" };
  }
  const envStatus = signer.envelope.status;
  if (envStatus !== "draft" && envStatus !== "running") {
    return { ok: false, status: 400, error: "Envelope não permite remoção neste estado" };
  }

  const creds = await resolveClickSignCreds(signer.envelope.orgId);
  if (signer.envelope.clicksignId && signer.clicksignId && creds) {
    try {
      await removeSigner(signer.envelope.clicksignId, signer.clicksignId, creds);
    } catch (err) {
      if (err instanceof ClicksignError && err.status !== 404) {
        return { ok: false, status: 502, error: `Clicksign: ${err.message}` };
      }
    }
  }

  await prisma.envelopeSigner.update({
    where: { id: signer.id },
    data: { status: "removed" },
  });
  return { ok: true, data: true };
}

export interface AddSignerData {
  name: string;
  email: string;
  documentation?: string;
  phone?: string;
  sourceKind: string;
  sourceIndex: number;
  role?: ClicksignRole;
  /** Grupo de ordem (ClickSign v3). */
  group?: number | null;
}

/** Adiciona um signatário a um envelope draft/running (cria signer +
 *  requirements de auth e qualificação na ClickSign). */
export async function addSignerToEnvelope(
  envelope: Envelope,
  data: AddSignerData
): Promise<ActionResult<Signer>> {
  // ClickSign v3 só aceita ADICIONAR signatário enquanto o envelope está
  // `draft`. Depois de ativado (`running`), a API rejeita ("envelope não está
  // no status draft") — antes esse erro cru vazava pro usuário como 502. Para
  // novo signatário exigimos draft e devolvemos orientação acionável.
  // (Editar/remover signatário existente em `running` segue em editSignerAction.)
  if (envelope.status !== "draft") {
    return {
      ok: false,
      status: 409,
      error:
        envelope.status === "running"
          ? "Este envelope já foi enviado para assinatura e não aceita novos signatários. Cancele o envio e reenvie incluindo a nova pessoa (testemunha, cônjuge etc.)."
          : "Envelope não permite adicionar signatários neste estado",
    };
  }

  const authMethod = (envelope.authMethod as AuthMethod) ?? "email";
  const documentation = data.documentation
    ? data.documentation.replace(/\D+/g, "")
    : undefined;
  const phone = data.phone ? data.phone.replace(/\D+/g, "") : undefined;
  const role: ClicksignRole = data.role ?? "sign";

  const localSigner = await prisma.envelopeSigner.create({
    data: {
      envelopeId: envelope.id,
      sourceKind: data.sourceKind,
      sourceIndex: data.sourceIndex,
      role,
      signingGroup: data.group ?? null,
      name: data.name,
      email: data.email,
      documentation,
      phone,
      authMethod,
      status: "pending",
    },
  });

  const creds = await resolveClickSignCreds(envelope.orgId);
  if (envelope.clicksignId && envelope.documentClicksignId && creds) {
    try {
      const signerResp = await addSigner(
        {
          envelopeId: envelope.clicksignId,
          name: data.name,
          email: data.email,
          documentation,
          phoneNumber: phone,
          hasDocumentation: Boolean(documentation),
          group: data.group ?? undefined,
        },
        creds
      );
      const signerId = pickId(signerResp);
      if (!signerId) throw new Error("Resposta sem id de signer");

      const authReq = await addRequirement(
        {
          envelopeId: envelope.clicksignId,
          documentClicksignId: envelope.documentClicksignId,
          signerClicksignId: signerId,
          action: "provide_evidence",
          auth: authMethod,
        },
        creds
      );
      const signReq = await addRequirement(
        {
          envelopeId: envelope.clicksignId,
          documentClicksignId: envelope.documentClicksignId,
          signerClicksignId: signerId,
          action: "agree",
          role,
        },
        creds
      );
      const reqIds = [pickId(authReq), pickId(signReq)].filter(Boolean) as string[];

      await prisma.envelopeSigner.update({
        where: { id: localSigner.id },
        data: {
          clicksignId: signerId,
          requirementIds: reqIds,
          // Envelope garantidamente `draft` aqui (guard acima) — signatário
          // só é notificado quando o envelope for ativado.
          status: "pending",
          notifiedAt: null,
        },
      });
    } catch (err) {
      await prisma.envelopeSigner.delete({ where: { id: localSigner.id } });
      if (err instanceof ClicksignError) {
        return { ok: false, status: 502, error: `Clicksign: ${err.message}` };
      }
      throw err;
    }
  }

  const fresh = await prisma.envelopeSigner.findUnique({
    where: { id: localSigner.id },
  });
  return { ok: true, data: fresh! };
}

function pickId(resp: unknown): string | null {
  if (!resp || typeof resp !== "object") return null;
  const data = (resp as { data?: unknown }).data;
  if (Array.isArray(data)) {
    return (data[0] as { id?: string } | undefined)?.id ?? null;
  }
  return (data as { id?: string } | undefined)?.id ?? null;
}
