import * as React from "react";
import { EmailLayout, ActionButton } from "./shared";

/**
 * Template genérico de "atualização do processo" enviado a corretores.
 * O branding da imobiliária entra via sendEmail({ orgId }) — ver shared.tsx.
 */
export interface DealUpdateEmailProps {
  recipientName: string;
  /** Título do evento, ex.: "Contrato assinado". */
  eventTitle: string;
  /** Frase do corpo, ex.: "O contrato do negócio X foi assinado por todas as partes." */
  eventBody: string;
  dealTitle: string | null;
  /** Rótulo do status atual do negócio (stage), quando fizer sentido. */
  stageName?: string | null;
  /** Link externo (CTA) — ex. link público do form no lembrete. Opcional. */
  ctaUrl?: string | null;
  ctaLabel?: string | null;
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#737373",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};
const valStyle: React.CSSProperties = { fontSize: 16, marginTop: 4 };

export function DealUpdateEmail({
  recipientName,
  eventTitle,
  eventBody,
  dealTitle,
  stageName,
  ctaUrl,
  ctaLabel,
}: DealUpdateEmailProps) {
  return (
    <EmailLayout title={eventTitle}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginTop: 0 }}>
        {eventTitle}
      </h1>
      <p>
        Olá {recipientName || ""}, temos uma atualização do negócio em que você
        participa como corretor(a).
      </p>
      <p style={{ fontSize: 15 }}>{eventBody}</p>
      <div style={{ marginTop: 16 }}>
        {dealTitle ? (
          <div style={{ marginBottom: 12 }}>
            <div style={labelStyle}>Negócio</div>
            <div style={valStyle}>{dealTitle}</div>
          </div>
        ) : null}
        {stageName ? (
          <div style={{ marginBottom: 12 }}>
            <div style={labelStyle}>Status atual</div>
            <div style={valStyle}>{stageName}</div>
          </div>
        ) : null}
      </div>
      {ctaUrl ? (
        <div style={{ marginTop: 24 }}>
          <ActionButton href={ctaUrl} label={ctaLabel ?? "Abrir"} />
        </div>
      ) : null}
      <p style={{ fontSize: 12, color: "#737373", marginTop: 24 }}>
        Você recebe estas atualizações porque está vinculado(a) a este negócio.
        Para deixar de receber, fale com a imobiliária responsável.
      </p>
    </EmailLayout>
  );
}
