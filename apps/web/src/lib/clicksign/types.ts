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

export type SourceKind =
  | "vendedor"
  | "comprador"
  | "testemunha"
  | "corretora"
  // Locação (aditivo) — partes do contrato de aluguel. DB guarda string livre,
  // então adicionar valores aqui é seguro (nenhuma query filtra por valor).
  | "locador"
  | "locatario"
  | "fiador";

// Distingue papéis derivados de uma MESMA parte (vendedor/comprador) dentro do
// envelope: o titular, o cônjuge, o procurador (PF) ou o representante legal
// (PJ assina pelo rep, não pela razão social). Usado pra casar o override de
// "Assina como" vindo da UI com o signer certo. DB não persiste subKind —
// resolução acontece em memória no momento da criação do envelope.
export type SubKind = "titular" | "conjuge" | "procurador" | "representante" | "avulso";

export interface SignerInput {
  sourceKind: SourceKind;
  sourceIndex: number;
  /** Papel derivado da parte (titular/cônjuge/procurador/representante). */
  subKind?: SubKind;
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
    // v3 atual também inclui esses campos no payload de webhook
    path?: string;
    locale?: string;
    auto_close?: boolean;
    deadline_at?: string | null;
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
