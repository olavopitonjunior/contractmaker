"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  FileText,
  LayoutDashboard,
  Sparkles,
  Mail,
  Lock,
  ArrowRight,
} from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("Email ou senha invalidos.");
      return;
    }

    router.push("/pipeline");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen">
      {/* Hero - Left Side */}
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
            Gestao inteligente de contratos imobiliarios
          </h1>
          <p className="text-lg text-white/80 mb-10 max-w-lg">
            Crie formularios, acompanhe negocios e gere contratos com inteligencia artificial.
          </p>

          <div className="space-y-5">
            {[
              { icon: FileText, text: "Formularios compartilhaveis com auto-save" },
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

          <div className="mt-16 flex items-center gap-3">
            <div className="flex -space-x-2">
              {["bg-blue-400", "bg-green-400", "bg-purple-400", "bg-pink-400"].map((bg, i) => (
                <div key={i} className={`h-8 w-8 rounded-full ${bg} border-2 border-white/30`} />
              ))}
            </div>
            <span className="text-sm text-white/70">+2.000 profissionais ja utilizam</span>
          </div>
        </div>
      </div>

      {/* Form - Right Side */}
      <div className="flex w-full lg:w-[42%] items-center justify-center bg-background p-6 sm:p-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold">
              CM
            </div>
            <span className="text-lg font-semibold">Contractmaker</span>
          </div>

          <h2 className="text-2xl font-bold mb-1">Bem-vindo de volta</h2>
          <p className="text-muted-foreground mb-8">
            Entre na sua conta para continuar
          </p>

          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive mb-6">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="seu@email.com"
                  className="pl-10"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Senha</Label>
                <button type="button" className="text-xs text-primary hover:underline">
                  Esqueceu a senha?
                </button>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="Minimo 6 caracteres"
                  className="pl-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
            </div>

            <Button type="submit" className="w-full h-11" disabled={loading}>
              {loading ? "Entrando..." : "Entrar"}
              {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
            </Button>
          </form>

          <div className="my-6 flex items-center gap-4">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">ou</span>
            <Separator className="flex-1" />
          </div>

          <Button variant="outline" className="w-full h-11" disabled>
            Entrar com Google (em breve)
          </Button>

          <p className="text-center text-sm text-muted-foreground mt-8">
            Nao tem conta?{" "}
            <Link href="/register" className="text-primary font-medium hover:underline">
              Cadastre-se gratuitamente
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
