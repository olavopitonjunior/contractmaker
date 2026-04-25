import * as React from "react";
import { EmailLayout, ActionButton } from "./shared";

export function PasswordResetEmail({
  resetUrl,
  expiresInMinutes = 60,
}: {
  resetUrl: string;
  expiresInMinutes?: number;
}) {
  return (
    <EmailLayout title="Redefinir sua senha">
      <h1 style={{ fontSize: 20, margin: "0 0 16px 0" }}>Redefinir senha</h1>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        Recebemos um pedido para redefinir a senha da sua conta no Contractmaker.
        Clique no botão abaixo para escolher uma nova senha.
      </p>
      <div style={{ margin: "24px 0" }}>
        <ActionButton href={resetUrl} label="Redefinir senha" />
      </div>
      <p style={{ fontSize: 13, color: "#737373" }}>
        Este link expira em {expiresInMinutes} minutos. Se você não pediu isso,
        ignore este email — sua senha não será alterada.
      </p>
    </EmailLayout>
  );
}

export function WelcomeSetPasswordEmail({
  inviterName,
  orgName,
  setupUrl,
}: {
  inviterName: string;
  orgName: string;
  setupUrl: string;
}) {
  return (
    <EmailLayout title={`Bem-vindo a ${orgName}`}>
      <h1 style={{ fontSize: 20, margin: "0 0 16px 0" }}>
        Bem-vindo a {orgName}
      </h1>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        {inviterName} te adicionou à organização <strong>{orgName}</strong> no
        Contractmaker. Para começar, defina sua senha de acesso.
      </p>
      <div style={{ margin: "24px 0" }}>
        <ActionButton href={setupUrl} label="Definir minha senha" />
      </div>
      <p style={{ fontSize: 13, color: "#737373" }}>
        Este link expira em 1 hora. Se você não esperava este convite, ignore
        este email.
      </p>
    </EmailLayout>
  );
}
