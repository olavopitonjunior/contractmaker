import * as React from "react";
import { EmailLayout } from "./shared";

export function DualApprovalResolvedEmail({
  initiatorName,
  approverName,
  kind,
  resolution,
  note,
}: {
  initiatorName: string;
  approverName: string;
  kind: string;
  resolution: "APPROVED" | "REJECTED";
  note?: string | null;
}) {
  const approved = resolution === "APPROVED";
  return (
    <EmailLayout title="Dual approval resolvido">
      <h1 style={{ fontSize: 20, margin: "0 0 16px 0" }}>
        Sua solicitação foi {approved ? "aprovada" : "rejeitada"}
      </h1>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        Olá {initiatorName}, {approverName} {approved ? "aprovou" : "rejeitou"} a
        operação <strong>{kind}</strong>.
      </p>
      {note && (
        <div
          style={{
            background: approved ? "#f0fdf4" : "#fef2f2",
            border: `1px solid ${approved ? "#bbf7d0" : "#fecaca"}`,
            borderRadius: 6,
            padding: 16,
            margin: "16px 0",
            fontSize: 14,
          }}
        >
          <strong>Observação:</strong> {note}
        </div>
      )}
      <p style={{ fontSize: 13, color: "#737373" }}>
        {approved
          ? "A operação foi executada automaticamente."
          : "Você pode iniciar uma nova operação se necessário."}
      </p>
    </EmailLayout>
  );
}
