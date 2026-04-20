import * as React from "react";
import { EmailLayout, ActionButton } from "./shared";

export function KycStatusChangedEmail({
  userName,
  orgName,
  newStatus,
  rejectionReason,
  dashboardUrl,
}: {
  userName: string;
  orgName: string;
  newStatus: "APPROVED" | "REJECTED" | "AWAITING_DOCS" | "BLOCKED";
  rejectionReason?: string | null;
  dashboardUrl: string;
}) {
  const titleMap = {
    APPROVED: "Conta Asaas aprovada ✓",
    REJECTED: "Documentos recusados — ação necessária",
    AWAITING_DOCS: "Documentos pendentes",
    BLOCKED: "Conta bloqueada",
  };

  const title = titleMap[newStatus];

  return (
    <EmailLayout title={title}>
      <h1 style={{ fontSize: 20, margin: "0 0 16px 0" }}>{title}</h1>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        Olá {userName}, a Asaas atualizou o status da conta financeira de{" "}
        <strong>{orgName}</strong>.
      </p>
      {rejectionReason && (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 6,
            padding: 16,
            margin: "16px 0",
            fontSize: 14,
          }}
        >
          <strong>Motivo:</strong> {rejectionReason}
        </div>
      )}
      <div style={{ margin: "24px 0" }}>
        <ActionButton href={dashboardUrl} label="Abrir painel" />
      </div>
    </EmailLayout>
  );
}
