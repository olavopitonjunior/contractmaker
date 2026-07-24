import * as React from "react";
import { EmailLayout, ActionButton } from "./shared";

export function SurveyDetractorAlertEmail({
  surveyName,
  respondentName,
  respondentRole,
  npsScore,
  csatScore,
  comment,
  dealUrl,
}: {
  surveyName: string;
  respondentName: string;
  respondentRole: string;
  npsScore: number | null;
  csatScore: number | null;
  comment: string | null;
  dealUrl: string | null;
}) {
  const scoreLabel = [
    npsScore !== null ? `NPS ${npsScore}/10` : null,
    csatScore !== null ? `CSAT ${csatScore}/5` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <EmailLayout title={`Alerta de nota baixa — ${surveyName}`}>
      <h1 style={{ fontSize: 20, margin: "0 0 16px 0", color: "#b91c1c" }}>
        ⚠️ Nota baixa em pesquisa de satisfação
      </h1>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        <strong>{respondentName}</strong> ({respondentRole}) respondeu a pesquisa{" "}
        <strong>{surveyName}</strong> com nota baixa: <strong>{scoreLabel}</strong>.
      </p>
      {comment && (
        <blockquote
          style={{
            margin: "16px 0",
            padding: "12px 16px",
            borderLeft: "3px solid #e5e5e5",
            fontSize: 14,
            lineHeight: 1.6,
            color: "#525252",
          }}
        >
          {comment}
        </blockquote>
      )}
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        Vale um contato rápido pra entender o que aconteceu e tentar reverter a
        experiência.
      </p>
      {dealUrl && (
        <div style={{ margin: "24px 0" }}>
          <ActionButton href={dealUrl} label="Abrir negócio" />
        </div>
      )}
    </EmailLayout>
  );
}
