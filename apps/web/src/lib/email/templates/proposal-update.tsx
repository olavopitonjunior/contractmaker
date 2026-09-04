import * as React from "react";
import { EmailLayout } from "./shared";

/**
 * Atualização de PROPOSTA para o corretor parceiro (externo ou da casa).
 *
 * Irmão do `DealUpdateEmail` com duas diferenças de propósito: (1) fala em
 * "proposta", não em "negócio" — o Deal ainda não existe; (2) NÃO leva CTA
 * para o dashboard: o parceiro típico não é membro da org e o link 404aria.
 * O resumo (imóvel, proponente, valor) é o que ele precisa para acompanhar.
 * O branding da imobiliária entra via sendEmail({ orgId }) — ver shared.tsx.
 */
export interface ProposalUpdateEmailProps {
  recipientName: string;
  /** Título do evento, ex.: "Proposta encaminhada para assinatura". */
  eventTitle: string;
  /** Frase do corpo, ex.: "A proposta foi enviada ao proponente para assinatura." */
  eventBody: string;
  /** "PROP-2026-0042" ou null (proposta anterior ao backfill do código). */
  proposalCode: string | null;
  proposalTitle: string;
  resumo: {
    proponente: string | null;
    imovel: string | null;
    valorLabel: string | null;
  };
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#737373",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};
const valStyle: React.CSSProperties = { fontSize: 16, marginTop: 4 };

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={labelStyle}>{label}</div>
      <div style={valStyle}>{value}</div>
    </div>
  );
}

export function ProposalUpdateEmail({
  recipientName,
  eventTitle,
  eventBody,
  proposalCode,
  proposalTitle,
  resumo,
}: ProposalUpdateEmailProps) {
  return (
    <EmailLayout title={eventTitle}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginTop: 0 }}>{eventTitle}</h1>
      <p>
        {`Olá ${recipientName || ""}, temos uma atualização da proposta em que você participa como corretor(a) parceiro(a).`}
      </p>
      <p style={{ fontSize: 15 }}>{eventBody}</p>
      <div style={{ marginTop: 16 }}>
        <Field
          label="Proposta"
          value={proposalCode ? `${proposalCode} — ${proposalTitle}` : proposalTitle}
        />
        <Field label="Imóvel" value={resumo.imovel} />
        <Field label="Proponente" value={resumo.proponente} />
        <Field label="Valor" value={resumo.valorLabel} />
      </div>
      <p style={{ fontSize: 12, color: "#737373", marginTop: 24 }}>
        Você recebe estas atualizações porque foi indicado(a) como corretor(a) parceiro(a)
        desta proposta. Para deixar de receber, fale com a imobiliária responsável.
      </p>
    </EmailLayout>
  );
}
