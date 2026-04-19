import * as React from "react";
import { EmailLayout, CodeBlock } from "./shared";

export function OtpChallengeEmail({
  userName,
  code,
  operation,
  expiresInMinutes = 5,
}: {
  userName: string;
  code: string;
  operation: string;
  expiresInMinutes?: number;
}) {
  return (
    <EmailLayout title="Código de confirmação">
      <h1 style={{ fontSize: 20, margin: "0 0 16px 0" }}>
        Código de confirmação
      </h1>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        Olá {userName}, use o código abaixo para confirmar a operação
        <strong> {operation}</strong>.
      </p>
      <CodeBlock code={code} />
      <p style={{ fontSize: 13, color: "#737373" }}>
        Este código expira em {expiresInMinutes} minutos e só pode ser usado uma vez.
      </p>
      <p style={{ fontSize: 13, color: "#737373" }}>
        Se não foi você que iniciou esta operação, ignore este email e troque
        sua senha imediatamente.
      </p>
    </EmailLayout>
  );
}
