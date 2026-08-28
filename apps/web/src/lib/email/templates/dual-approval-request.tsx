import * as React from "react";
import { EmailLayout, ActionButton } from "./shared";

export function DualApprovalRequestEmail({
  approverName,
  initiatorName,
  orgName,
  kind,
  amountBrl,
  reason,
  approvalUrl,
  expiresAt,
}: {
  approverName: string;
  initiatorName: string;
  orgName: string;
  kind: string;
  amountBrl?: string;
  reason?: string | null;
  approvalUrl: string;
  expiresAt: string;
}) {
  const kindLabel =
    {
      TRANSFER: "Transferência",
      REFUND_LARGE: "Estorno de alto valor",
      SPLIT_CHANGE: "Alteração de repasse",
      FEES_CHANGE: "Alteração de taxas",
    }[kind] ?? kind;

  return (
    <EmailLayout title="Aprovação dupla necessária">
      <h1 style={{ fontSize: 20, margin: "0 0 16px 0" }}>
        Aprovação dupla solicitada
      </h1>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        Olá {approverName}, {initiatorName} iniciou uma operação em {orgName} que
        exige sua aprovação antes de ser executada.
      </p>
      <div
        style={{
          background: "#fffbeb",
          border: "1px solid #fde68a",
          borderRadius: 6,
          padding: 16,
          margin: "16px 0",
          fontSize: 14,
          lineHeight: 1.8,
        }}
      >
        <div><strong>Tipo:</strong> {kindLabel}</div>
        {amountBrl && <div><strong>Valor:</strong> {amountBrl}</div>}
        {reason && <div><strong>Motivo:</strong> {reason}</div>}
      </div>
      <div style={{ margin: "24px 0" }}>
        <ActionButton href={approvalUrl} label="Revisar e aprovar" />
      </div>
      <p style={{ fontSize: 13, color: "#737373" }}>
        Esta solicitação expira em {expiresAt}. Para aprovar você precisará
        confirmar sua identidade (senha + 2FA).
      </p>
    </EmailLayout>
  );
}
