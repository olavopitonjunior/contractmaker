"use client";

import { Suspense, useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  FileText,
  LayoutDashboard,
  Sparkles,
  Mail,
  Lock,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import { BrandWordmark } from "@/components/layout/brand-mark";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [magicSent, setMagicSent] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);
  const checkEmail = searchParams.get("check-email") === "1";
  const prefill = searchParams.get("email");

  useEffect(() => {
    if (prefill) setEmail(prefill);
  }, [prefill]);

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

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMagicLoading(true);
    try {
      const result = await signIn("resend", {
        email,
        redirect: false,
        callbackUrl: "/pipeline",
      });
      if (result?.error) {
        setError(
          "Não foi possível enviar o link. Verifique se você foi convidado e aprovado."
        );
        return;
      }
      setMagicSent(true);
    } finally {
      setMagicLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* Hero - Left Side */}
      <div className="hidden lg:flex lg:w-[58%] relative bg-gradient-to-br from-teal-900 via-teal-800 to-teal-700 text-white">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTTAgMCBMNjAgNjAiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjA1KSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCBmaWxsPSJ1cmwoI2cpIiB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIi8+PC9zdmc+')] opacity-30" />
        <div className="relative z-10 flex flex-col justify-center px-16 xl:px-24">
          <BrandWordmark
            className="mb-12"
            markClassName="h-11 w-11 text-white"
            textClassName="text-xl text-white"
            accentClassName="text-white/75"
          />

          <h1 className="font-display text-4xl xl:text-5xl font-bold leading-tight mb-6">
            Gestão inteligente de contratos imobiliários
          </h1>
          <p className="text-lg text-white/80 mb-10 max-w-lg">
            Crie formulários, acompanhe negócios e gere contratos com inteligência artificial.
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
      <div className="flex w-full lg:w-[42%] items-center justify-center bg-background p-4 sm:p-8 lg:p-12">
        <div className="w-full max-w-md">
          <BrandWordmark className="lg:hidden mb-10" markClassName="text-primary" />

          <h2 className="text-2xl font-bold mb-1">Bem-vindo de volta</h2>
          <p className="text-muted-foreground mb-6">
            Entre na sua conta para continuar
          </p>

          {(checkEmail || magicSent) && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-900 mb-6 flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <strong>Verifique seu email.</strong> Enviamos um link de acesso.
                Clique nele para entrar — válido por 15 minutos.
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive mb-6">
              {error}
            </div>
          )}

          <Tabs defaultValue="magic" className="w-full">
            <TabsList className="grid grid-cols-2 mb-6">
              <TabsTrigger value="magic">Link no email</TabsTrigger>
              <TabsTrigger value="senha">Email + senha</TabsTrigger>
            </TabsList>

            <TabsContent value="magic">
              <form onSubmit={handleMagicLink} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="magic-email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="magic-email"
                      type="email"
                      placeholder="seu@email.com"
                      className="pl-10"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Receba um link único no seu email — sem senha. Válido por 15
                    minutos.
                  </p>
                </div>
                <Button
                  type="submit"
                  className="w-full h-11"
                  disabled={magicLoading || !email}
                >
                  {magicLoading ? "Enviando..." : "Enviar link"}
                  {!magicLoading && <ArrowRight className="ml-2 h-4 w-4" />}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="senha">
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
                  <Label htmlFor="password">Senha</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="Sua senha"
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
            </TabsContent>
          </Tabs>

          <p className="text-center text-xs text-muted-foreground mt-8">
            O acesso à plataforma é apenas por convite de um administrador.
          </p>
        </div>
      </div>
    </div>
  );
}
