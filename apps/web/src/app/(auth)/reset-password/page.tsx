"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Lock,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Eye,
  EyeOff,
} from "lucide-react";

interface TokenInfo {
  valid: boolean;
  email?: string;
  reason?: "reset" | "welcome";
}

function ResetPasswordContent() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setInfo({ valid: false });
      return;
    }
    fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => setInfo(d))
      .catch(() => setInfo({ valid: false }));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("A senha precisa ter ao menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("As senhas não conferem.");
      return;
    }

    setLoading(true);
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Não foi possível redefinir a senha.");
      return;
    }

    setDone(true);

    // Auto-login após reset/welcome
    const result = await signIn("credentials", {
      email: data.email,
      password,
      redirect: false,
    });

    setTimeout(() => {
      if (result?.ok) {
        router.push("/pipeline");
        router.refresh();
      } else {
        router.push("/login");
      }
    }, 1500);
  }

  // Loading
  if (info === null) {
    return (
      <Centered>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground mt-3">Validando link…</p>
      </Centered>
    );
  }

  // Token inválido
  if (!info.valid) {
    return (
      <Centered>
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-4">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Link inválido ou expirado</h2>
        <p className="text-muted-foreground mb-6 text-center">
          O link de recuperação não é válido ou já foi usado. Solicite um novo
          link de redefinição.
        </p>
        <Button asChild className="w-full">
          <Link href="/forgot-password">Solicitar novo link</Link>
        </Button>
        <Button asChild variant="ghost" className="w-full mt-2">
          <Link href="/login">Voltar ao login</Link>
        </Button>
      </Centered>
    );
  }

  // Sucesso — redirecionando
  if (done) {
    return (
      <Centered>
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 mb-4">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Senha definida</h2>
        <p className="text-muted-foreground">Entrando na sua conta…</p>
      </Centered>
    );
  }

  const isWelcome = info.reason === "welcome";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 sm:p-8">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-10">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold">
            CM
          </div>
          <span className="text-lg font-semibold">Contractmaker</span>
        </div>

        <h2 className="text-2xl font-bold mb-1">
          {isWelcome ? "Bem-vindo!" : "Redefinir senha"}
        </h2>
        <p className="text-muted-foreground mb-2">
          {isWelcome
            ? "Para começar, defina sua senha de acesso."
            : "Escolha uma nova senha segura."}
        </p>
        {info.email && (
          <p className="text-sm text-muted-foreground mb-8">
            Conta: <strong>{info.email}</strong>
          </p>
        )}

        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive mb-6">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="password">
              {isWelcome ? "Sua senha" : "Nova senha"}
            </Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="Mínimo 8 caracteres"
                className="pl-10 pr-10"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm">Confirme a senha</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="confirm"
                type={showPassword ? "text" : "password"}
                placeholder="Repita a senha"
                className="pl-10"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
              />
            </div>
          </div>

          <Button type="submit" className="w-full h-11" disabled={loading}>
            {loading
              ? "Salvando..."
              : isWelcome
                ? "Criar senha e entrar"
                : "Redefinir senha"}
            {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
          </Button>
        </form>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="flex flex-col items-center max-w-md w-full">{children}</div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <Centered>
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </Centered>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
