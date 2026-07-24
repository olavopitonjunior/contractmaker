import * as React from "react";
import { EmailLayout, ActionButton } from "./shared";

export function SurveyInviteEmail({
  recipientName,
  surveyName,
  surveyUrl,
  optoutUrl,
  isReminder,
}: {
  recipientName: string;
  surveyName: string;
  surveyUrl: string;
  optoutUrl: string;
  isReminder?: boolean;
}) {
  return (
    <EmailLayout title={surveyName}>
      <h1 style={{ fontSize: 20, margin: "0 0 16px 0" }}>
        {isReminder
          ? "Sua opinião ainda é importante pra gente"
          : "Queremos ouvir sua opinião"}
      </h1>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        Olá{recipientName ? `, ${recipientName}` : ""}!{" "}
        {isReminder
          ? "Notamos que você ainda não respondeu nossa pesquisa. Leva menos de 2 minutos:"
          : "Sua experiência conosco importa. Responda nossa pesquisa rápida — leva menos de 2 minutos:"}
      </p>
      <div style={{ margin: "24px 0" }}>
        <ActionButton href={surveyUrl} label="Responder pesquisa" />
      </div>
      <p style={{ fontSize: 13, color: "#737373", lineHeight: 1.6 }}>
        Se o botão não funcionar, copie e cole este endereço no navegador:{" "}
        <a href={surveyUrl}>{surveyUrl}</a>
      </p>
      <p style={{ fontSize: 12, color: "#a3a3a3", lineHeight: 1.6, marginTop: 24 }}>
        Não quer receber pesquisas?{" "}
        <a href={optoutUrl} style={{ color: "#a3a3a3" }}>
          Cancelar recebimento
        </a>
      </p>
    </EmailLayout>
  );
}
