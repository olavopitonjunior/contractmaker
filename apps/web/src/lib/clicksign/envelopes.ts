import { clicksignRequest } from "./client";
import type { ClicksignResponse, AuthMethod } from "./types";

interface CreateEnvelopeInput {
  name: string;
  deadlineAt?: Date | null;
  autoClose?: boolean;
  locale?: "pt-BR" | "en-US";
}

export async function createEnvelope(input: CreateEnvelopeInput) {
  const attributes: Record<string, unknown> = {
    name: input.name,
    locale: input.locale || "pt-BR",
    auto_close: input.autoClose ?? true,
  };
  if (input.deadlineAt) {
    attributes.deadline_at = input.deadlineAt.toISOString();
  }
  return clicksignRequest<ClicksignResponse>({
    method: "POST",
    path: "/api/v3/envelopes",
    body: { data: { type: "envelopes", attributes } },
  });
}

interface AddDocumentInput {
  envelopeId: string;
  filename: string;
  contentBase64: string;
}

// Recebe o conteúdo do PDF como data URL: data:application/pdf;base64,...
export async function addDocument(input: AddDocumentInput) {
  const dataUrl = `data:application/pdf;base64,${input.contentBase64}`;
  return clicksignRequest<ClicksignResponse>({
    method: "POST",
    path: `/api/v3/envelopes/${input.envelopeId}/documents`,
    body: {
      data: {
        type: "documents",
        attributes: {
          filename: input.filename,
          content_base64: dataUrl,
        },
      },
    },
  });
}

interface AddSignerInput {
  envelopeId: string;
  name: string;
  email: string;
  documentation?: string;
  phoneNumber?: string;
  hasDocumentation?: boolean;
  birthday?: string; // YYYY-MM-DD
  refusable?: boolean;
}

/**
 * Cria signer no envelope. **Notificação é por email automaticamente** — a
 * ClickSign v3 envia o link de assinatura para o `email` do signer assim
 * que `activateEnvelope` muda o status pra "running".
 *
 * O atributo `communicate_by` da v1.x foi REMOVIDO na v3 — mandar gera 422
 * "communicate_by não está disponível". O canal é derivado dos contatos
 * preenchidos no signer (email obrigatório → email; phone_number → SMS via
 * Auth requirement separado quando aplicável).
 *
 * Para autenticação por SMS/WhatsApp/Selfie/ICP-Brasil, configure o canal
 * via POST /requirements (action="provide_evidence", auth=...) — não no
 * signer.
 */
export async function addSigner(input: AddSignerInput) {
  const attributes: Record<string, unknown> = {
    name: input.name,
    email: input.email,
    has_documentation: input.hasDocumentation ?? Boolean(input.documentation),
    refusable: input.refusable ?? true,
  };
  if (input.documentation) {
    // ClickSign v3 exige CPF/CNPJ formatado com máscara
    // ("XXX.XXX.XXX-XX" ou "XX.XXX.XXX/XXXX-XX"). Mandar só dígitos
    // retorna 422 "documentation não está em um formato válido".
    attributes.documentation = formatCpfCnpj(input.documentation);
  }
  if (input.phoneNumber) attributes.phone_number = input.phoneNumber;
  if (input.birthday) attributes.birthday = input.birthday;

  return clicksignRequest<ClicksignResponse>({
    method: "POST",
    path: `/api/v3/envelopes/${input.envelopeId}/signers`,
    body: { data: { type: "signers", attributes } },
  });
}

export async function removeSigner(envelopeId: string, signerId: string) {
  return clicksignRequest<void>({
    method: "DELETE",
    path: `/api/v3/envelopes/${envelopeId}/signers/${signerId}`,
  });
}

interface AddRequirementInput {
  envelopeId: string;
  documentClicksignId: string;
  signerClicksignId: string;
  // Tipo do requisito (ClickSign v3):
  //   - "agree"            → rubrica/concordância
  //   - "provide_evidence" → autenticação (combinada com `auth`)
  //   - "sign"             → assinatura propriamente dita (combinada com `role`)
  action: "agree" | "provide_evidence" | "sign";
  // Para action=provide_evidence: o auth method usado.
  auth?: AuthMethod;
  // Para action=sign: papel do signer no documento. ClickSign v3 aceita
  // "signer" (assinante padrão), "witness" (testemunha) e "intervening".
  role?: "signer" | "witness" | "intervening";
}

export async function addRequirement(input: AddRequirementInput) {
  const attributes: Record<string, unknown> = { action: input.action };
  if (input.auth) attributes.auth = input.auth;
  if (input.role) attributes.role = input.role;

  return clicksignRequest<ClicksignResponse>({
    method: "POST",
    path: `/api/v3/envelopes/${input.envelopeId}/requirements`,
    body: {
      data: {
        type: "requirements",
        attributes,
        relationships: {
          document: { data: { type: "documents", id: input.documentClicksignId } },
          signer: { data: { type: "signers", id: input.signerClicksignId } },
        },
      },
    },
  });
}

export async function activateEnvelope(envelopeId: string) {
  return clicksignRequest<ClicksignResponse>({
    method: "PATCH",
    path: `/api/v3/envelopes/${envelopeId}`,
    body: {
      data: {
        id: envelopeId,
        type: "envelopes",
        attributes: { status: "running" },
      },
    },
  });
}

export async function cancelEnvelope(envelopeId: string) {
  return clicksignRequest<ClicksignResponse>({
    method: "PATCH",
    path: `/api/v3/envelopes/${envelopeId}`,
    body: {
      data: {
        id: envelopeId,
        type: "envelopes",
        attributes: { status: "canceled" },
      },
    },
  });
}

export async function deleteDraftEnvelope(envelopeId: string) {
  return clicksignRequest<void>({
    method: "DELETE",
    path: `/api/v3/envelopes/${envelopeId}`,
  });
}

export async function getEnvelope(envelopeId: string) {
  return clicksignRequest<ClicksignResponse>({
    method: "GET",
    path: `/api/v3/envelopes/${envelopeId}`,
  });
}

interface UpdateEnvelopeInput {
  envelopeId: string;
  name?: string;
  deadlineAt?: Date | null;
}

export async function updateEnvelope(input: UpdateEnvelopeInput) {
  const attributes: Record<string, unknown> = {};
  if (input.name !== undefined) attributes.name = input.name;
  if (input.deadlineAt !== undefined) {
    attributes.deadline_at = input.deadlineAt
      ? input.deadlineAt.toISOString()
      : null;
  }
  return clicksignRequest<ClicksignResponse>({
    method: "PATCH",
    path: `/api/v3/envelopes/${input.envelopeId}`,
    body: {
      data: {
        id: input.envelopeId,
        type: "envelopes",
        attributes,
      },
    },
  });
}

export async function notifySigner(envelopeId: string, signerId: string) {
  return clicksignRequest<ClicksignResponse>({
    method: "POST",
    path: `/api/v3/envelopes/${envelopeId}/signers/${signerId}/notifications`,
    body: { data: { type: "notifications", attributes: {} } },
  });
}

interface UpdateSignerInput {
  envelopeId: string;
  signerId: string;
  name?: string;
  email?: string;
  documentation?: string;
  phoneNumber?: string;
  birthday?: string;
}

export async function updateSigner(input: UpdateSignerInput) {
  const attributes: Record<string, unknown> = {};
  if (input.name !== undefined) attributes.name = input.name;
  if (input.email !== undefined) attributes.email = input.email;
  if (input.documentation !== undefined) {
    attributes.documentation = input.documentation
      ? formatCpfCnpj(input.documentation)
      : input.documentation;
    attributes.has_documentation = Boolean(input.documentation);
  }
  if (input.phoneNumber !== undefined) attributes.phone_number = input.phoneNumber;
  if (input.birthday !== undefined) attributes.birthday = input.birthday;

  return clicksignRequest<ClicksignResponse>({
    method: "PATCH",
    path: `/api/v3/envelopes/${input.envelopeId}/signers/${input.signerId}`,
    body: {
      data: {
        id: input.signerId,
        type: "signers",
        attributes,
      },
    },
  });
}

/**
 * Formata CPF/CNPJ pra `XXX.XXX.XXX-XX` ou `XX.XXX.XXX/XXXX-XX`. Aceita
 * input com ou sem máscara — sempre normaliza pelos dígitos. Retorna o
 * input original se não tiver 11 nem 14 dígitos (caso edge — deixa
 * ClickSign emitir o erro de validação se for mesmo inválido).
 */
export function formatCpfCnpj(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length === 11) {
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  if (d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }
  return raw;
}
