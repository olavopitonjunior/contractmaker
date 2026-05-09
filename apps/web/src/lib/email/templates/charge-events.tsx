import * as React from "react";
import { EmailLayout, ActionButton } from "./shared";

interface OwnerEmailProps {
  ownerName: string;
  customerName: string;
  valueStr: string;
  dueDateStr: string;
  dealTitle: string | null;
  linkUrl: string;
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#737373",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};
const valStyle: React.CSSProperties = { fontSize: 16, marginTop: 4 };
const rowStyle: React.CSSProperties = { marginBottom: 12 };

function FactsTable({
  rows,
}: {
  rows: Array<{ label: string; value: React.ReactNode }>;
}) {
  return (
    <div style={{ marginTop: 16 }}>
      {rows.map((r, i) => (
        <div key={i} style={rowStyle}>
          <div style={labelStyle}>{r.label}</div>
          <div style={valStyle}>{r.value}</div>
        </div>
      ))}
    </div>
  );
}

export function ChargeCreatedEmail({
  ownerName,
  customerName,
  valueStr,
  dueDateStr,
  dealTitle,
  linkUrl,
}: OwnerEmailProps) {
  return (
    <EmailLayout title="Cobrança criada">
      <h1 style={{ fontSize: 22, fontWeight: 600, marginTop: 0 }}>
        Cobrança criada
      </h1>
      <p>Olá {ownerName || ""}, uma nova cobrança foi gerada e enviada ao pagador.</p>
      <FactsTable
        rows={[
          { label: "Pagador", value: customerName },
          { label: "Valor", value: valueStr },
          { label: "Vencimento", value: dueDateStr },
          ...(dealTitle ? [{ label: "Negócio", value: dealTitle }] : []),
        ]}
      />
      <div style={{ marginTop: 24 }}>
        <ActionButton href={linkUrl} label="Ver cobrança" />
      </div>
    </EmailLayout>
  );
}

export function ChargePaidOwnerEmail({
  ownerName,
  customerName,
  valueStr,
  dueDateStr,
  dealTitle,
  linkUrl,
}: OwnerEmailProps) {
  return (
    <EmailLayout title="Cobrança paga">
      <h1 style={{ fontSize: 22, fontWeight: 600, marginTop: 0, color: "#15803d" }}>
        Cobrança paga
      </h1>
      <p>Olá {ownerName || ""}, o pagamento foi confirmado pela Asaas.</p>
      <FactsTable
        rows={[
          { label: "Pagador", value: customerName },
          { label: "Valor recebido (bruto)", value: valueStr },
          { label: "Vencimento original", value: dueDateStr },
          ...(dealTitle ? [{ label: "Negócio", value: dealTitle }] : []),
        ]}
      />
      <p style={{ fontSize: 13, color: "#737373", marginTop: 16 }}>
        Splits para destinatários PIX externos foram disparados automaticamente.
      </p>
      <div style={{ marginTop: 24 }}>
        <ActionButton href={linkUrl} label="Ver detalhes e splits" />
      </div>
    </EmailLayout>
  );
}

export function ChargeOverdueEmail({
  ownerName,
  customerName,
  valueStr,
  dueDateStr,
  dealTitle,
  linkUrl,
}: OwnerEmailProps) {
  return (
    <EmailLayout title="Cobrança vencida">
      <h1 style={{ fontSize: 22, fontWeight: 600, marginTop: 0, color: "#b91c1c" }}>
        Cobrança vencida
      </h1>
      <p>
        Olá {ownerName || ""}, a cobrança de {customerName} venceu sem pagamento.
        Considere entrar em contato com o pagador.
      </p>
      <FactsTable
        rows={[
          { label: "Pagador", value: customerName },
          { label: "Valor", value: valueStr },
          { label: "Venceu em", value: dueDateStr },
          ...(dealTitle ? [{ label: "Negócio", value: dealTitle }] : []),
        ]}
      />
      <div style={{ marginTop: 24 }}>
        <ActionButton href={linkUrl} label="Ver cobrança" />
      </div>
    </EmailLayout>
  );
}

export function ChargeDueSoonEmail({
  ownerName,
  customerName,
  valueStr,
  dueDateStr,
  dealTitle,
  linkUrl,
}: OwnerEmailProps) {
  return (
    <EmailLayout title="Cobrança vence em 3 dias">
      <h1 style={{ fontSize: 22, fontWeight: 600, marginTop: 0, color: "#b45309" }}>
        Cobrança vence em 3 dias
      </h1>
      <p>
        Olá {ownerName || ""}, lembrete: a cobrança de {customerName} vence em
        breve.
      </p>
      <FactsTable
        rows={[
          { label: "Pagador", value: customerName },
          { label: "Valor", value: valueStr },
          { label: "Vence em", value: dueDateStr },
          ...(dealTitle ? [{ label: "Negócio", value: dealTitle }] : []),
        ]}
      />
      <p style={{ fontSize: 13, color: "#737373", marginTop: 16 }}>
        A Asaas notificará automaticamente o pagador. Este aviso é só interno.
      </p>
      <div style={{ marginTop: 24 }}>
        <ActionButton href={linkUrl} label="Ver cobrança" />
      </div>
    </EmailLayout>
  );
}

export function ChargePaidRecipientEmail({
  recipientName,
  customerName,
  valueStr,
  grossStr,
  dealTitle,
  recipientType,
}: {
  recipientName: string;
  customerName: string;
  valueStr: string;
  grossStr: string;
  dealTitle: string | null;
  recipientType: string;
}) {
  const isPixExternal = recipientType === "pix_external";
  return (
    <EmailLayout title="Você recebeu um split">
      <h1 style={{ fontSize: 22, fontWeight: 600, marginTop: 0, color: "#15803d" }}>
        Pagamento recebido
      </h1>
      <p>
        Olá {recipientName}, o pagamento de {customerName} foi confirmado e seu
        repasse {isPixExternal ? "via PIX foi disparado" : "foi creditado na sua conta Asaas"}.
      </p>
      <FactsTable
        rows={[
          { label: "Valor recebido (estimado)", value: valueStr },
          { label: "Valor total da cobrança", value: grossStr },
          ...(dealTitle ? [{ label: "Negócio", value: dealTitle }] : []),
          {
            label: "Modalidade",
            value: isPixExternal ? "PIX externo" : "Conta Asaas (split nativo)",
          },
        ]}
      />
      {isPixExternal && (
        <p style={{ fontSize: 13, color: "#737373", marginTop: 16 }}>
          O valor exato pode variar levemente em função da taxa PIX da Asaas.
          Confira o crédito no seu banco em alguns minutos.
        </p>
      )}
    </EmailLayout>
  );
}
