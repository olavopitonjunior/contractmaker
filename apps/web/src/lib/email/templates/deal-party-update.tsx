import * as React from "react";
import { EmailLayout, ActionButton } from "./shared";

/**
 * Aviso de processo para a PARTE do negócio (comprador/vendedor,
 * locador/locatário) — o cliente final da imobiliária.
 *
 * Não é o `deal-update.tsx`: aquele fala com quem trabalha o negócio (corretor
 * ou equipe) e cita status da esteira, nome interno do negócio e o painel. Aqui
 * o destinatário nunca viu o ImobPro. Por isso:
 *
 *  - nada de stage, título interno do negócio ou link de dashboard — o único
 *    CTA possível é um link PÚBLICO que já exista (ex.: a página de pagamento);
 *  - quem assina é a imobiliária (branding vem do `sendEmail({ orgId })`), e a
 *    saída é falar com ela, não um centro de preferências que ela não tem.
 */
export interface DealPartyUpdateEmailProps {
  recipientName: string;
  /** Título do evento em linguagem de cliente, ex.: "Contrato assinado". */
  eventTitle: string;
  /** Corpo em uma ou duas frases, sem jargão de esteira. */
  eventBody: string;
  /** Link PÚBLICO já existente (ex.: /pay/[token]). Nunca link autenticado. */
  ctaUrl?: string | null;
  ctaLabel?: string | null;
  /** Nome fantasia da imobiliária — usado no rodapé de contato. */
  orgName: string;
}

export function DealPartyUpdateEmail({
  recipientName,
  eventTitle,
  eventBody,
  ctaUrl,
  ctaLabel,
  orgName,
}: DealPartyUpdateEmailProps) {
  const firstName = (recipientName ?? "").trim().split(/\s+/)[0] ?? "";
  return (
    <EmailLayout title={eventTitle}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginTop: 0 }}>
        {eventTitle}
      </h1>
      <p>{firstName ? `Olá, ${firstName}.` : "Olá."}</p>
      <p style={{ fontSize: 15 }}>{eventBody}</p>
      {ctaUrl ? (
        <div style={{ marginTop: 24 }}>
          <ActionButton href={ctaUrl} label={ctaLabel ?? "Abrir"} />
        </div>
      ) : null}
      <p style={{ fontSize: 12, color: "#737373", marginTop: 24 }}>
        Você recebeu este aviso porque participa deste negócio. Em caso de
        dúvida, fale com {orgName} — basta responder a este e-mail.
      </p>
    </EmailLayout>
  );
}
