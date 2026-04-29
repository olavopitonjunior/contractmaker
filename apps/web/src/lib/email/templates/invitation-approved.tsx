import * as React from "react";
import { EmailLayout, ActionButton } from "./shared";

export function InvitationApprovedEmail({
  inviteeName,
  orgName,
  loginUrl,
}: {
  inviteeName: string | null;
  orgName: string;
  loginUrl: string;
}) {
  return (
    <EmailLayout title={`Acesso aprovado em ${orgName}`}>
      <h1 style={{ fontSize: 20, margin: "0 0 16px 0" }}>
        Bem-vindo{inviteeName ? `, ${inviteeName}` : ""}
      </h1>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        Seu acesso a <strong>{orgName}</strong> foi aprovado.
      </p>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        Não há senha para criar — toda vez que você quiser entrar, peça um link
        de acesso pelo seu email na tela de login.
      </p>
      <div style={{ margin: "24px 0" }}>
        <ActionButton href={loginUrl} label="Entrar agora" />
      </div>
      <p style={{ fontSize: 13, color: "#737373" }}>
        Se você não esperava este acesso, ignore este email.
      </p>
    </EmailLayout>
  );
}
