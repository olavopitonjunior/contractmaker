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
        Recebemos um pedido para redefinir a senha da sua conta no imobpro.ai.
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
        imobpro.ai. Para começar, defina sua senha de acesso.
      </p>
      <div style={{ margin: "24px 0" }}>
        <ActionButton href={setupUrl} label="Definir minha senha" />
      </div>
      <p style={{ fontSize: 13, color: "#737373" }}>
        Este link expira em 7 dias. Se você não esperava este convite, ignore
        este email.
      </p>
    </EmailLayout>
  );
}

/**
 * Primeiro acesso do DONO de uma imobiliária recém-provisionada (painel super-admin).
 * Diferente do WelcomeSetPasswordEmail: aqui ninguém "te adicionou" a uma equipe —
 * a conta da imobiliária inteira é da pessoa, e o próximo passo é o onboarding.
 */
export function OwnerAccessEmail({
  orgName,
  setupUrl,
}: {
  orgName: string;
  setupUrl: string;
}) {
  return (
    <EmailLayout title={`${orgName} no imobpro.ai`}>
      <h1 style={{ fontSize: 20, margin: "0 0 16px 0" }}>
        A conta da {orgName} está pronta
      </h1>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        Criamos a conta da <strong>{orgName}</strong> no imobpro.ai e você é o
        responsável por ela. Defina sua senha para entrar — o próprio sistema vai
        te guiar, passo a passo, até o primeiro contrato.
      </p>
      <div style={{ margin: "24px 0" }}>
        <ActionButton href={setupUrl} label="Definir minha senha" />
      </div>
      <p style={{ fontSize: 13, color: "#737373" }}>
        Este link expira em 7 dias. Se ele vencer, use &quot;Esqueci minha
        senha&quot; na tela de login com este mesmo e-mail.
      </p>
    </EmailLayout>
  );
}
