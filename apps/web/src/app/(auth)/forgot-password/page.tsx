"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, ArrowRight, ArrowLeft, CheckCircle2 } from "lucide-react";
import { BrandWordmark } from "@/components/layout/brand-mark";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    });

    setLoading(false);

    if (res.status === 429) {
      setError("Muitas tentativas. Aguarde alguns minutos.");
      return;
    }
    if (!res.ok) {
      setError("Não foi possível processar sua solicitação. Tente novamente.");
      return;
    }
    setSent(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 sm:p-8">
      <div className="w-full max-w-md">
        <BrandWordmark className="mb-10" markClassName="text-primary" />

        {sent ? (
          <div className="space-y-6">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 mb-4">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h2 className="font-display tracking-tight text-2xl font-bold mb-2">Verifique seu email</h2>
              <p className="text-muted-foreground">
                Se o email <strong>{email}</strong> estiver cadastrado, você
                receberá um link de recuperação em instantes.
              </p>
            </div>
            <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
              <p className="mb-2 font-medium text-foreground">Não chegou?</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>Verifique a pasta de spam</li>
                <li>O link expira em 1 hora</li>
                <li>Confirme se digitou o email corretamente</li>
              </ul>
            </div>
            <Button asChild variant="outline" className="w-full">
              <Link href="/login">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Voltar ao login
              </Link>
            </Button>
          </div>
        ) : (
          <>
            <h2 className="font-display tracking-tight text-2xl font-bold mb-1">Esqueci minha senha</h2>
            <p className="text-muted-foreground mb-8">
              Digite seu email e enviaremos um link para redefinir sua senha.
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
                    autoFocus
                  />
                </div>
              </div>

              <Button type="submit" className="w-full h-11" disabled={loading || !email}>
                {loading ? "Enviando..." : "Enviar link de recuperação"}
                {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
              </Button>
            </form>

            <p className="text-center text-sm text-muted-foreground mt-8">
              Lembrou da senha?{" "}
              <Link href="/login" className="text-primary font-medium hover:underline">
                Voltar ao login
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
