import * as React from "react";

export function EmailLayout({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="utf-8" />
        <title>{title}</title>
      </head>
      <body
        style={{
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          background: "#f5f5f5",
          padding: 24,
          color: "#0f172a",
        }}
      >
        <div
          style={{
            maxWidth: 560,
            margin: "0 auto",
            background: "#ffffff",
            borderRadius: 8,
            padding: 32,
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
            Contractmaker
          </div>
          {children}
          <hr style={{ border: 0, borderTop: "1px solid #e5e5e5", margin: "24px 0" }} />
          <div style={{ fontSize: 12, color: "#737373" }}>
            Esta é uma mensagem automática de segurança. Se você não fez esta ação,
            responda este email imediatamente.
          </div>
        </div>
      </body>
    </html>
  );
}

export function CodeBlock({ code }: { code: string }) {
  return (
    <div
      style={{
        fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
        fontSize: 32,
        letterSpacing: 8,
        background: "#f5f5f5",
        border: "1px solid #e5e5e5",
        borderRadius: 6,
        padding: "16px 24px",
        textAlign: "center",
        margin: "16px 0",
      }}
    >
      {code}
    </div>
  );
}

export function ActionButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      style={{
        display: "inline-block",
        background: "#0f172a",
        color: "#ffffff",
        padding: "12px 24px",
        borderRadius: 6,
        textDecoration: "none",
        fontSize: 15,
        fontWeight: 500,
      }}
    >
      {label}
    </a>
  );
}
