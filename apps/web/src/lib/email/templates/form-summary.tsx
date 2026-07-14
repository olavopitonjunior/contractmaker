import * as React from "react";
import { EmailLayout, ActionButton } from "./shared";

export function FormSummaryEmail({
  orgName,
  formTitle,
  highlights,
  pdfUrl,
  attachedCount,
  attachmentsSkipped,
}: {
  orgName: string;
  formTitle: string;
  highlights?: { label: string; value: string }[];
  pdfUrl?: string | null;
  attachedCount?: number;
  attachmentsSkipped?: boolean;
}) {
  return (
    <EmailLayout title={formTitle}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginTop: 0 }}>
        Resumo do formulário
      </h1>
      <p>
        Segue o resumo consolidado do formulário <strong>{formTitle}</strong>
        {orgName ? ` (${orgName})` : ""}. O PDF com todos os dados preenchidos
        está anexado a este e-mail.
      </p>

      {highlights && highlights.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", margin: "16px 0", fontSize: 14 }}>
          <tbody>
            {highlights.map((h, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "6px 8px", color: "#555", fontWeight: 600, width: "40%" }}>
                  {h.label}
                </td>
                <td style={{ padding: "6px 8px" }}>{h.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {typeof attachedCount === "number" && attachedCount > 0 && (
        <p style={{ fontSize: 14 }}>
          {attachedCount} documento(s) anexado(s) junto ao PDF.
        </p>
      )}

      {attachmentsSkipped && (
        <p style={{ fontSize: 13, color: "#92400e", background: "#fef3c7", padding: "8px 12px", borderRadius: 6 }}>
          Os documentos anexados não couberam no e-mail e foram omitidos. Use o
          link do PDF abaixo ou acesse a pasta do negócio na plataforma.
        </p>
      )}

      {pdfUrl && (
        <div style={{ marginTop: 20 }}>
          <ActionButton href={pdfUrl} label="Abrir PDF do resumo" />
        </div>
      )}
    </EmailLayout>
  );
}
