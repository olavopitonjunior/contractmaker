import * as React from "react";

/**
 * Marca que assina o e-mail. Injetada por `sendEmail` quando o call-site passa
 * `orgId` (ver lib/email/client.ts) — nenhum template precisa receber prop.
 *
 * Sem org (reset de senha, OTP e outros e-mails de plataforma), vale o default:
 * a marca do produto. Antes disso, TODO e-mail — inclusive as cobranças que vão
 * pro cliente da imobiliária — saía assinado "Contractmaker".
 */
export interface EmailBrand {
  displayName: string;
  logoUrl: string | null;
  primaryColor: string;
  supportEmail: string | null;
}

export const PLATFORM_BRAND: EmailBrand = {
  displayName: "imobpro",
  logoUrl: null,
  primaryColor: "#0f172a",
  supportEmail: null,
};

const EmailBrandContext = React.createContext<EmailBrand>(PLATFORM_BRAND);

export function EmailBrandProvider({
  brand,
  children,
}: {
  brand: EmailBrand;
  children: React.ReactNode;
}) {
  return <EmailBrandContext.Provider value={brand}>{children}</EmailBrandContext.Provider>;
}

export function EmailLayout({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const brand = React.useContext(EmailBrandContext);
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 16,
              paddingBottom: 12,
              borderBottom: `2px solid ${brand.primaryColor}`,
            }}
          >
            {brand.logoUrl ? (
              <img
                src={brand.logoUrl}
                alt={brand.displayName}
                style={{ maxHeight: 36, maxWidth: 160, display: "block" }}
              />
            ) : (
              <span
                style={{ fontSize: 18, fontWeight: 600, color: brand.primaryColor }}
              >
                {brand.displayName}
              </span>
            )}
          </div>
          {children}
          <hr style={{ border: 0, borderTop: "1px solid #e5e5e5", margin: "24px 0" }} />
          <div style={{ fontSize: 12, color: "#737373" }}>
            Mensagem automática de {brand.displayName}.
            {brand.supportEmail ? (
              <>
                {" "}
                Dúvidas? Fale com{" "}
                <a href={`mailto:${brand.supportEmail}`} style={{ color: "#737373" }}>
                  {brand.supportEmail}
                </a>
                .
              </>
            ) : (
              " Se você não reconhece esta ação, responda este e-mail imediatamente."
            )}
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
