import { clicksignRequest, type ClicksignCreds } from "./client";

/**
 * Aceite via WhatsApp — `POST /api/v3/acceptance_term/whatsapps`.
 *
 * Produto SEPARADO do envelope (não assina o PDF; é um aceite de texto + link).
 * ~R$0,99, cobrado na ENTREGA. `message` tem 1500 chars e não aceita anexo — por
 * isso carrega o resumo + o link pra landing + a frase de vinculação ao documento.
 * Só usar quando a conta NÃO tem assinatura por WhatsApp (roteamento em
 * lib/proposals/routing.ts).
 */

export interface CreateAcceptanceInput {
  title: string;
  /** Texto aceito (≤1500 chars). Deve conter a frase de vinculação + o link. */
  message: string;
  signerName: string;
  /** E.164 sem o '+', como o resto da integração (ver formatação no caller). */
  signerPhone: string;
  /** "account_name" usa o nome da conta ClickSign como remetente. */
  senderNameOption?: string;
  senderPhone?: string;
}

interface AcceptanceResponse {
  data?: { id?: string; attributes?: Record<string, unknown> };
}

export async function createAcceptanceWhatsapp(
  input: CreateAcceptanceInput,
  creds?: ClicksignCreds
) {
  return clicksignRequest<AcceptanceResponse>({
    method: "POST",
    path: "/api/v3/acceptance_term/whatsapps",
    body: {
      data: {
        type: "acceptance_term_whatsapps",
        attributes: {
          title: input.title,
          message: input.message,
          signer_name: input.signerName,
          signer_phone: input.signerPhone,
          sender_name_option: input.senderNameOption ?? "account_name",
          ...(input.senderPhone ? { sender_phone: input.senderPhone } : {}),
        },
      },
    },
    creds,
  });
}

/**
 * Lê um aceite. Usado no webhook `completed` pra montar o comprovante e tentar
 * o Log de Evidências da ClickSign (best-effort — a API não documenta o link).
 */
export async function getAcceptanceWhatsapp(
  acceptanceId: string,
  creds?: ClicksignCreds
) {
  return clicksignRequest<AcceptanceResponse>({
    method: "GET",
    path: `/api/v3/acceptance_term/whatsapps/${acceptanceId}`,
    creds,
  });
}
