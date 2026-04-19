import * as React from "react";
import { EmailLayout, ActionButton } from "./shared";

export function TransferSuspiciousEmail({
  userName,
  amountBrl,
  destination,
  executeAtIso,
  cancelUrl,
  reasons,
}: {
  userName: string;
  amountBrl: string;
  destination: string;
  executeAtIso: string;
  cancelUrl: string;
  reasons: string[];
}) {
  return (
    <EmailLayout title="Transferência agendada — revisão de segurança">
      <h1 style={{ fontSize: 20, margin: "0 0 16px 0" }}>
        Transferência em análise de segurança
      </h1>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        Olá {userName}, uma transferência de{" "}
        <strong>{amountBrl}</strong> para <strong>{destination}</strong> foi
        iniciada e será executada em <strong>{executeAtIso}</strong>.
      </p>
      <div
        style={{
          background: "#fffbeb",
          border: "1px solid #fde68a",
          borderRadius: 6,
          padding: 16,
          margin: "16px 0",
          fontSize: 14,
        }}
      >
        <strong>Motivos da revisão:</strong>
        <ul style={{ margin: "8px 0 0 16px", padding: 0 }}>
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        Se não foi você que iniciou, cancele agora:
      </p>
      <div style={{ margin: "16px 0" }}>
        <ActionButton href={cancelUrl} label="Cancelar transferência" />
      </div>
    </EmailLayout>
  );
}
