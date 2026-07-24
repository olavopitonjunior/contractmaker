import { clicksignRequest, ClicksignError, type ClicksignCreds } from "./client";
import type { ClicksignResponse, AuthMethod } from "./types";
import type { ClicksignRole } from "./roles";

// Re-export pra não quebrar imports existentes (`import { type ClicksignRole }
// from "./envelopes"`). Fonte canônica do tipo + labels agora é `./roles`.
export type { ClicksignRole };

interface CreateEnvelopeInput {
  name: string;
  deadlineAt?: Date | null;
  autoClose?: boolean;
  locale?: "pt-BR" | "en-US";
}

export async function createEnvelope(
  input: CreateEnvelopeInput,
  creds?: ClicksignCreds
) {
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
    creds,
  });
}

interface AddDocumentInput {
  envelopeId: string;
  filename: string;
  contentBase64: string;
}

// Recebe o conteúdo do PDF como data URL: data:application/pdf;base64,...
export async function addDocument(
  input: AddDocumentInput,
  creds?: ClicksignCreds
) {
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
    creds,
  });
}

interface AddSignerInput {
  envelopeId: string;
  name: string;
  /** Opcional: signatário notificado só por WhatsApp não tem e-mail. */
  email?: string;
  documentation?: string;
  phoneNumber?: string;
  hasDocumentation?: boolean;
  birthday?: string; // YYYY-MM-DD
  refusable?: boolean;
  /** Ordem de assinatura (ClickSign v3): signatários do grupo N só são
   *  notificados depois que todos do grupo N-1 assinam. Omitir = todos no
   *  mesmo grupo (assinam em paralelo). */
  group?: number;
  /** Canal de notificação (communicate_events.signature_request). Default
   *  "email". "whatsapp" exige o plano Plus da conta — ver capabilities. */
  notifyChannel?: "email" | "whatsapp" | "sms" | "none";
}

/**
 * Cria signer no envelope.
 *
 * O canal de notificação é o `communicate_events` (v3). NÃO confundir com
 * `communicate_by`, que era o campo da **v2** — a v3 renomeou (provado contra a
 * conta real 2026-07-14: `communicate_events` com valores de e-mail → 201).
 *
 * `communicate_events.signature_request` aceita `none|email|whatsapp|sms`;
 * `signature_reminder` aceita SÓ `none|email` (sem e-mail → `none`, senão 422);
 * `document_signed` aceita `email|whatsapp`. `whatsapp` exige o plano Plus da
 * conta — o caller (executor) só deve mandar `notifyChannel:"whatsapp"` quando
 * `OrgSignatureSettings.whatsappSignatureAvailable` for true.
 */
export async function addSigner(input: AddSignerInput, creds?: ClicksignCreds) {
  const attributes: Record<string, unknown> = {
    name: input.name,
    has_documentation: input.hasDocumentation ?? Boolean(input.documentation),
    refusable: input.refusable ?? true,
  };
  // Omitido quando ausente (signatário só-WhatsApp). Mandar `email: null` gera
  // 422; o certo é não mandar a chave.
  if (input.email) attributes.email = input.email;

  const channel = input.notifyChannel ?? "email";
  const hasEmail = Boolean(input.email && input.email.includes("@"));
  attributes.communicate_events = {
    signature_request: channel,
    // enum SÓ aceita none|email. Sem e-mail não há como lembrar → "none".
    signature_reminder: hasEmail && channel !== "none" ? "email" : "none",
    document_signed: channel === "whatsapp" ? "whatsapp" : "email",
  };
  if (input.documentation) {
    const digits = input.documentation.replace(/\D/g, "");
    if (digits.length === 14) {
      // 2026-06-03 — ClickSign v3 só aceita CPF no `documentation` do signer
      // (assinante é pessoa física). Um CNPJ (14 díg.) — caso de parte PJ cujo
      // signatário deveria ser o representante — retorna 422 "documentation não
      // está em um formato válido" e TRAVA o envelope inteiro. A PJ assina via
      // representante (e-mail); quando só temos o CNPJ, omitimos a documentação
      // em vez de quebrar o envio. (confirmado em teste real no deal Walter Santos)
      attributes.has_documentation = false;
    } else {
      // CPF: ClickSign v3 exige máscara ("XXX.XXX.XXX-XX"); só dígitos → 422.
      attributes.documentation = formatCpfCnpj(input.documentation);
    }
  }
  if (input.phoneNumber) attributes.phone_number = input.phoneNumber;
  if (input.birthday) attributes.birthday = input.birthday;
  if (typeof input.group === "number") attributes.group = input.group;

  return clicksignRequest<ClicksignResponse>({
    method: "POST",
    path: `/api/v3/envelopes/${input.envelopeId}/signers`,
    body: { data: { type: "signers", attributes } },
    creds,
  });
}

export async function removeSigner(
  envelopeId: string,
  signerId: string,
  creds?: ClicksignCreds
) {
  return clicksignRequest<void>({
    method: "DELETE",
    path: `/api/v3/envelopes/${envelopeId}/signers/${signerId}`,
    creds,
  });
}

/**
 * Papel do signatário no requirement de qualificação ClickSign v3.
 * Lista derivada da tabela "Assinar como" (qualifications) da ClickSign.
 *
 * Mapeamento UI → API:
 *   - Assinante     → "sign"
 *   - Comprador     → "buyer"
 *   - Vendedor      → "seller"
 *   - Intermediador → "intervening"
 *   - Imobiliária   → "realestate"
 *   - Testemunha    → "witness"
 *   - Anuente       → "consenting"
 *   - Advogado      → "attorney"
 *   - Interessado   → "party"
 * (tipo e labels em `./roles`)
 */

interface AddRequirementInput {
  envelopeId: string;
  documentClicksignId: string;
  signerClicksignId: string;
  // Tipo do requisito (ClickSign v3):
  //   - "agree"            → qualificação/concordância (signer assina como X);
  //                          REQUER `role`
  //   - "provide_evidence" → autenticação (combinada com `auth`)
  action: "agree" | "provide_evidence";
  // Para action=provide_evidence: o auth method usado.
  auth?: AuthMethod;
  // Para action=agree: papel do signer (qualificação).
  role?: ClicksignRole;
}

export async function addRequirement(
  input: AddRequirementInput,
  creds?: ClicksignCreds
) {
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
    creds,
  });
}

/**
 * Remove um requirement (auth `provide_evidence` ou qualificação `agree`) de um
 * envelope. Usado ao TROCAR o tipo de assinatura ou o papel de um signatário já
 * criado: como a v3 não tem PATCH de requirement, deleta-se o antigo e recria-se
 * o novo. Tolerar 404 no chamador (requirement já removido).
 */
export async function removeRequirement(
  envelopeId: string,
  requirementId: string,
  creds?: ClicksignCreds
) {
  return clicksignRequest<void>({
    method: "DELETE",
    path: `/api/v3/envelopes/${envelopeId}/requirements/${requirementId}`,
    creds,
  });
}

export async function activateEnvelope(
  envelopeId: string,
  creds?: ClicksignCreds
) {
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
    creds,
  });
}

export async function cancelEnvelope(
  envelopeId: string,
  creds?: ClicksignCreds
) {
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
    creds,
  });
}

export async function deleteDraftEnvelope(
  envelopeId: string,
  creds?: ClicksignCreds
) {
  return clicksignRequest<void>({
    method: "DELETE",
    path: `/api/v3/envelopes/${envelopeId}`,
    creds,
  });
}

export async function getEnvelope(envelopeId: string, creds?: ClicksignCreds) {
  return clicksignRequest<ClicksignResponse>({
    method: "GET",
    path: `/api/v3/envelopes/${envelopeId}`,
    creds,
  });
}

/**
 * Lista signers de um envelope. ATENÇÃO: retorna só perfil (nome/email/
 * documento/birthday) — o STATUS de assinatura está nos requirements
 * (action=agree). Pra reconciliar quem assinou, use `listEnvelopeRequirements`.
 */
export async function listEnvelopeSigners(
  envelopeId: string,
  creds?: ClicksignCreds
) {
  return clicksignRequest<ClicksignResponse>({
    method: "GET",
    path: `/api/v3/envelopes/${envelopeId}/signers`,
    creds,
  });
}

/**
 * Lista requirements de um envelope. Empiricamente: a v3 retorna apenas
 * a DEFINIÇÃO (action, role, auth, rubric_field, created/modified) —
 * SEM status nem fulfilled_at nem relationship com signer. Pra saber
 * se um signer assinou, use `listEnvelopeEvents`.
 */
export async function listEnvelopeRequirements(
  envelopeId: string,
  creds?: ClicksignCreds
) {
  return clicksignRequest<ClicksignResponse>({
    method: "GET",
    path: `/api/v3/envelopes/${envelopeId}/requirements`,
    creds,
  });
}

/**
 * Lista eventos do envelope (auth, sign, view, refusal, etc.). É a
 * fonte canônica pra acompanhar quem assinou e quando — webhook
 * dispara o mesmo fluxo, mas o endpoint REST permite reconciliação
 * manual quando o webhook não chega.
 */
export async function listEnvelopeEvents(
  envelopeId: string,
  creds?: ClicksignCreds
) {
  return clicksignRequest<ClicksignResponse>({
    method: "GET",
    path: `/api/v3/envelopes/${envelopeId}/events`,
    creds,
  });
}

/**
 * Lista documentos do envelope. Atributos retornados v3:
 * `status, filename, template, metadata, migrated, created, modified`.
 *
 * Cada doc tem `links.files` (objeto, não string) com URLs pré-assinadas
 * direto pro PDF binário:
 * ```
 * { original: "https://...", signed: "https://...", ziped: "https://..." }
 * ```
 * Após close, `signed` aponta pro PDF com certificado de assinatura.
 */
export async function listEnvelopeDocuments(
  envelopeId: string,
  creds?: ClicksignCreds
) {
  return clicksignRequest<ClicksignResponse>({
    method: "GET",
    path: `/api/v3/envelopes/${envelopeId}/documents`,
    creds,
  });
}


/**
 * Lista webhooks cadastrados na conta ClickSign. Usado pra diagnosticar
 * quando webhooks não estão chegando (URL não registrada, eventos
 * filtrados, etc.).
 */
export async function listWebhooks(creds?: ClicksignCreds) {
  return clicksignRequest<ClicksignResponse>({
    method: "GET",
    path: `/api/v3/webhooks`,
    creds,
  });
}

/**
 * Cadastra um webhook na conta ClickSign apontando pra `url`. A ClickSign gera
 * o HMAC secret por webhook e o devolve na resposta (campo varia — o chamador
 * extrai defensivamente). Auto-provisionamento no connect per-org.
 *
 * ClickSign v3 (confirmado 2026-07-14 contra a conta real): o campo do endereço
 * é `endpoint` (NÃO `url` — `url` retorna 400 "não está disponível"); `status`
 * = "active" | "inactive"; `events` = array de eventos a assinar (omitir tem
 * comportamento ambíguo, então passamos explicitamente).
 */
/** Eventos ClickSign v3 que o webhook-process trata — assinados no provisionamento. */
export const WEBHOOK_EVENTS = [
  "sign",
  "close",
  "auto_close",
  "document_closed",
  "refusal",
  "cancel",
  "deadline",
  "add_signer",
  "remove_signer",
];

export async function createWebhook(
  input: { url: string; events?: string[] },
  creds?: ClicksignCreds
) {
  const attributes: Record<string, unknown> = {
    endpoint: input.url,
    status: "active",
  };
  if (input.events && input.events.length > 0) {
    attributes.events = input.events;
  }
  return clicksignRequest<ClicksignResponse>({
    method: "POST",
    path: `/api/v3/webhooks`,
    body: { data: { type: "webhooks", attributes } },
    creds,
  });
}

export async function deleteWebhook(webhookId: string, creds?: ClicksignCreds) {
  return clicksignRequest<void>({
    method: "DELETE",
    path: `/api/v3/webhooks/${webhookId}`,
    creds,
  });
}

function pickWebhookId(resp: unknown): string | null {
  return (resp as { data?: { id?: string } }).data?.id ?? null;
}

function pickWebhookSecret(resp: unknown): string | null {
  const attrs =
    (resp as { data?: { attributes?: Record<string, unknown> } }).data
      ?.attributes ?? {};
  const c =
    attrs.secret ??
    attrs.hmac_secret ??
    attrs.hmac ??
    attrs.signing_secret ??
    attrs.secret_key;
  return typeof c === "string" && c.length > 0 ? c : null;
}

/**
 * Garante um webhook na conta apontando pra `url`: cria; se a ClickSign
 * recusar com "endpoint já está em uso" (reconexão ou webhook criado à mão),
 * lista os webhooks e ADOTA o que já aponta pra essa URL (sem duplicar). O
 * secret só vem no create (a listagem não expõe) — nesse caso retorna null e o
 * chamador preserva o secret existente/manual.
 */
export async function ensureWebhook(
  url: string,
  events: string[],
  creds?: ClicksignCreds
): Promise<{ webhookId: string | null; secret: string | null; adopted: boolean }> {
  try {
    const resp = await createWebhook({ url, events }, creds);
    return { webhookId: pickWebhookId(resp), secret: pickWebhookSecret(resp), adopted: false };
  } catch (err) {
    const conflict =
      err instanceof ClicksignError &&
      /em uso|already|taken|duplicat/i.test(err.message);
    if (!conflict) throw err;
    // Adota o webhook existente com o mesmo endpoint.
    const list = await listWebhooks(creds);
    const data = (list as { data?: unknown }).data;
    if (Array.isArray(data)) {
      const match = (data as Array<{
        id?: string;
        attributes?: { endpoint?: string; url?: string; secret?: string };
      }>).find(
        (w) => w.attributes?.endpoint === url || w.attributes?.url === url
      );
      if (match?.id) {
        // A listagem expõe o secret do webhook — captura pra HMAC bater sem o
        // usuário colar manualmente.
        const s = match.attributes?.secret;
        return {
          webhookId: match.id,
          secret: typeof s === "string" && s.length > 0 ? s : null,
          adopted: true,
        };
      }
    }
    throw err;
  }
}

interface UpdateEnvelopeInput {
  envelopeId: string;
  name?: string;
  deadlineAt?: Date | null;
}

export async function updateEnvelope(
  input: UpdateEnvelopeInput,
  creds?: ClicksignCreds
) {
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
    creds,
  });
}

export async function notifySigner(
  envelopeId: string,
  signerId: string,
  creds?: ClicksignCreds
) {
  return clicksignRequest<ClicksignResponse>({
    method: "POST",
    path: `/api/v3/envelopes/${envelopeId}/signers/${signerId}/notifications`,
    body: { data: { type: "notifications", attributes: {} } },
    creds,
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

export async function updateSigner(
  input: UpdateSignerInput,
  creds?: ClicksignCreds
) {
  const attributes: Record<string, unknown> = {};
  if (input.name !== undefined) attributes.name = input.name;
  if (input.email !== undefined) attributes.email = input.email;
  if (input.documentation !== undefined) {
    // Mesmo guard de CNPJ do `addSigner` (ver comentário lá): 14 dígitos → a
    // ClickSign devolve 422 "documentation não está em um formato válido",
    // porque quem assina é sempre PF. Sem isso, editar o signatário de uma
    // parte PJ que só tem CNPJ (sem CPF do representante) trava o PATCH.
    const digits = input.documentation.replace(/\D/g, "");
    if (digits.length === 14) {
      // `null` explícito limpa um CPF que já estivesse lá — sem isso, trocar um
      // CPF por um CNPJ deixaria o documento antigo na ClickSign enquanto o DB
      // local passa a guardar o CNPJ (signer-actions.ts), e os dois divergem.
      attributes.documentation = null;
      attributes.has_documentation = false;
    } else {
      attributes.documentation = input.documentation
        ? formatCpfCnpj(input.documentation)
        : input.documentation;
      attributes.has_documentation = Boolean(input.documentation);
    }
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
    creds,
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
