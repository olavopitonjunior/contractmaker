import * as React from "react";
import { EmailLayout, ActionButton } from "./shared";

export function MemberInvitedEmail({
  inviterName,
  orgName,
  role,
  acceptUrl,
}: {
  inviterName: string;
  orgName: string;
  role: string;
  acceptUrl: string;
}) {
  return (
    <EmailLayout title={`Convite para ${orgName}`}>
      <h1 style={{ fontSize: 20, margin: "0 0 16px 0" }}>
        Você foi convidado para {orgName}
      </h1>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        {inviterName} te adicionou como <strong>{role}</strong> na organização
        <strong> {orgName}</strong> no Contractmaker.
      </p>
      <div style={{ margin: "24px 0" }}>
        <ActionButton href={acceptUrl} label="Aceitar convite" />
      </div>
      <p style={{ fontSize: 13, color: "#737373" }}>
        Este link expira em 7 dias. Se você não esperava este convite, ignore este email.
      </p>
    </EmailLayout>
  );
}
