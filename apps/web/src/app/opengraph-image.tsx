import { ImageResponse } from "next/og";

// OG/social card do imobpro.ai — fundo teal editorial + mark + wordmark.
// Satori (next/og) renderiza um subconjunto de CSS/SVG; mantemos simples e
// sem fontes custom (usa a sans default) pra ser robusto em qualquer build.
export const runtime = "edge";
export const alt = "imobpro.ai — gestão de vendas e contratos imobiliários";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "96px",
          background: "linear-gradient(135deg, #0c4a45 0%, #115E59 55%, #15756d 100%)",
          color: "#F7F5F0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <svg width="120" height="120" viewBox="0 0 64 64" fill="none">
            <path
              d="M32 5 L55.4 18.5 V45.5 L32 59 L8.6 45.5 V18.5 Z"
              stroke="#F7F5F0"
              strokeWidth="4"
              strokeLinejoin="round"
            />
            <circle cx="32" cy="22.5" r="3.4" fill="#F7F5F0" />
            <rect x="29" y="29.5" width="6" height="18.5" rx="3" fill="#F7F5F0" />
          </svg>
          <div style={{ display: "flex", fontSize: 96, fontWeight: 700, letterSpacing: -2 }}>
            imobpro
            <span style={{ color: "#E8B4BC" }}>.ai</span>
          </div>
        </div>
        <div
          style={{
            marginTop: 36,
            fontSize: 40,
            color: "rgba(247,245,240,0.82)",
            maxWidth: 880,
            lineHeight: 1.3,
          }}
        >
          Gestão inteligente de vendas e contratos imobiliários
        </div>
      </div>
    ),
    { ...size }
  );
}
