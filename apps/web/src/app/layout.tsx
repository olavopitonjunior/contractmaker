import type { Metadata } from "next";
import { Inter, Merriweather, Tinos } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// Inter: default UI font and one of the contract presets (modern sans).
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Merriweather: elegant serif for editorial contract preset.
const merriweather = Merriweather({
  subsets: ["latin"],
  weight: ["300", "400", "700"],
  variable: "--font-merriweather",
  display: "swap",
});

// Tinos: metric-compatible with Times New Roman — guarantees the formal
// serif preset looks identical on every machine regardless of system fonts.
const tinos = Tinos({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-tinos",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Contractmaker",
  description: "Plataforma de gestao de vendas e contratos imobiliarios",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} ${merriweather.variable} ${tinos.variable}`}
    >
      <body>
        <TooltipProvider>
          {children}
          <Toaster richColors position="bottom-right" />
        </TooltipProvider>
      </body>
    </html>
  );
}
