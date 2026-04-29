import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  FileText,
  LayoutDashboard,
  Sparkles,
  ShieldCheck,
} from "lucide-react";

export const metadata = {
  title: "Acesso por convite — Contractmaker",
};

export default function RegisterPage() {
  return (
    <div className="flex min-h-screen">
      <div className="hidden lg:flex lg:w-[58%] relative bg-gradient-to-br from-orange-600 via-orange-500 to-amber-500 text-white">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTTAgMCBMNjAgNjAiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjA1KSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCBmaWxsPSJ1cmwoI2cpIiB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIi8+PC9zdmc+')] opacity-30" />
        <div className="relative z-10 flex flex-col justify-center px-16 xl:px-24">
          <div className="flex items-center gap-3 mb-12">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm text-white font-bold text-lg">
              CM
            </div>
            <span className="text-xl font-semibold">Contractmaker</span>
          </div>

          <h1 className="text-4xl xl:text-5xl font-bold leading-tight mb-6">
            Acesso é por convite
          </h1>
          <p className="text-lg text-white/80 mb-10 max-w-lg">
            A plataforma é restrita. Solicite um convite a um administrador da
            sua organização para começar.
          </p>

          <div className="space-y-5">
            {[
              { icon: FileText, text: "Formulários compartilhaveis com auto-save" },
              { icon: LayoutDashboard, text: "Pipeline de vendas com kanban visual" },
              { icon: Sparkles, text: "Contratos gerados e editados com IA" },
            ].map(({ icon: Icon, text }, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/15 backdrop-blur-sm">
                  <Icon className="h-5 w-5" />
                </div>
                <span className="text-white/90">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex w-full lg:w-[42%] items-center justify-center bg-background p-4 sm:p-8 lg:p-12">
        <div className="w-full max-w-md text-center">
          <div className="lg:hidden flex items-center justify-center gap-3 mb-10">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold">
              CM
            </div>
            <span className="text-lg font-semibold">Contractmaker</span>
          </div>

          <div className="flex justify-center mb-6">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <ShieldCheck className="h-7 w-7 text-primary" />
            </div>
          </div>

          <h2 className="text-2xl font-bold mb-2">Cadastro fechado</h2>
          <p className="text-muted-foreground mb-8">
            Esta plataforma só permite acesso por convite. Peça a um administrador
            que envie um convite para o seu email — assim que aprovado, você
            recebe um link de acesso direto na sua caixa de entrada (sem senha).
          </p>

          <Button asChild className="w-full h-11">
            <Link href="/login">Já tenho acesso — entrar</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
