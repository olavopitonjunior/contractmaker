import type { Metadata } from "next";
import { Inter, Merriweather, Tinos, Source_Serif_4 } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CookieBanner } from "@/components/legal/CookieBanner";
import { ThemeProvider } from "@/components/theme-provider";
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

// Source Serif 4: editorial display serif for the app shell (headings,
// brand). Exposed as --font-source-serif → --font-display in the DS.
// NOTE: distinct from the contract-document serifs (Tinos/Merriweather),
// which must stay untouched.
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-source-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "imobpro.ai",
    template: "%s · imobpro.ai",
  },
  description: "Plataforma de gestão de vendas e contratos imobiliários",
  manifest: "/manifest.json",
  applicationName: "imobpro.ai",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "imobpro.ai",
  },
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  icons: {
    icon: "/brand/imobpro-mark-draft.svg",
    apple: "/brand/imobpro-mark-draft.svg",
  },
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 5,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${inter.variable} ${merriweather.variable} ${tinos.variable} ${sourceSerif.variable}`}
    >
      <body>
        <ThemeProvider>
          <TooltipProvider>
            {children}
            <CookieBanner />
            <Toaster richColors position="bottom-right" />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
