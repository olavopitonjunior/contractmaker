// Tipos do domínio interno + envelope JSON:API mínimo da Clicksign v3.

export type EnvelopeStatus =
  | "draft"
  | "running"
  | "closed"
  | "canceled"
  | "failed";

export type SignerStatus =
  | "pending"
  | "notified"
  | "viewed"
  | "signed"
  | "refused"
  | "removed";

export type AuthMethod = "email" | "whatsapp" | "selfie" | "icp_brasil";

export type SourceKind = "vendedor" | "comprador";

export interface SignerInput {
  sourceKind: SourceKind;
  sourceIndex: number;
  name: string;
  email: string;
  documentation?: string;
  phone?: string;
  authMethod: AuthMethod;
}

// Resposta JSON:API genérica da Clicksign
export interface ClicksignResource<T = Record<string, unknown>> {
  id: string;
  type: string;
  attributes: T;
  relationships?: Record<string, unknown>;
}

export interface ClicksignResponse<T = Record<string, unknown>> {
  data: ClicksignResource<T> | ClicksignResource<T>[];
  included?: ClicksignResource[];
}

// Eventos de webhook que tratamos
export type WebhookEventName =
  | "upload"
  | "add_signer"
  | "remove_signer"
  | "sign"
  | "signature_started"
  | "refusal"
  | "cancel"
  | "close"
  | "auto_close"
  | "deadline"
  | "document_closed"
  | "update_deadline";

export interface WebhookPayload {
  event: {
    name: WebhookEventName;
    data?: Record<string, unknown>;
    occurred_at?: string;
  };
  document?: {
    key?: string;
    filename?: string;
    status?: string;
    finished_at?: string | null;
    downloads?: { signed_file_url?: string; original_file_url?: string };
  };
  envelope?: {
    id?: string;
    status?: string;
  };
  signers?: Array<{
    key?: string;
    email?: string;
    sign_as?: string;
    has_documentation?: boolean;
    documentation?: string;
    name?: string;
    signed_at?: string | null;
    refused_at?: string | null;
  }>;
  // Webhooks da v3 também podem mandar o objeto completo
  data?: Record<string, unknown>;
}
