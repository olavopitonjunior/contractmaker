import * as React from "react";
import { EmailLayout } from "./shared";

export function SecurityAlertEmail({
  userName,
  eventType,
  detail,
  ipAddress,
  userAgent,
  timestamp,
}: {
  userName: string;
  eventType: string;
  detail: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  timestamp: string;
}) {
  return (
    <EmailLayout title="Alerta de segurança">
      <h1 style={{ fontSize: 20, margin: "0 0 16px 0", color: "#b91c1c" }}>
        ⚠ Alerta de segurança
      </h1>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        Olá {userName}, detectamos uma atividade na sua conta que merece sua atenção:
      </p>
      <div
        style={{
          background: "#fef2f2",
          border: "1px solid #fecaca",
          borderRadius: 6,
          padding: 16,
          margin: "16px 0",
          fontSize: 14,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>{eventType}</div>
        <div>{detail}</div>
      </div>
      <div style={{ fontSize: 13, color: "#737373", lineHeight: 1.8 }}>
        <div>Data: {timestamp}</div>
        {ipAddress && <div>IP: {ipAddress}</div>}
        {userAgent && <div>Dispositivo: {userAgent.slice(0, 80)}</div>}
      </div>
      <p style={{ fontSize: 13, color: "#737373", marginTop: 16 }}>
        Se foi você, ignore esta mensagem. Se não reconhece esta atividade,
        acesse /settings/seguranca e revogue todos os dispositivos confiáveis.
      </p>
    </EmailLayout>
  );
}
