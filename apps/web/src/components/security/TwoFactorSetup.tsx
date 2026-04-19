"use client";
import { useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, Check } from "lucide-react";

type Step = "idle" | "scan" | "confirm" | "recovery" | "done";

export function TwoFactorSetup({ onComplete }: { onComplete?: () => void }) {
  const [step, setStep] = useState<Step>("idle");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function startSetup() {
    setLoading(true);
    try {
      const res = await fetch("/api/security/2fa/setup", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Falha ao iniciar setup");
        return;
      }
      setQrDataUrl(data.qrCodeDataUrl);
      setSecret(data.secret);
      setStep("scan");
    } finally {
      setLoading(false);
    }
  }

  async function confirmEnable() {
    setLoading(true);
    try {
      const res = await fetch("/api/security/2fa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Código incorreto");
        return;
      }
      setRecoveryCodes(data.recoveryCodes ?? []);
      setStep("recovery");
    } finally {
      setLoading(false);
    }
  }

  function finishSetup() {
    setStep("done");
    toast.success("2FA ativado com sucesso");
    onComplete?.();
  }

  function copyRecovery() {
    navigator.clipboard.writeText(recoveryCodes.join("\n"));
    setCopied(true);
    toast.success("Códigos copiados");
    setTimeout(() => setCopied(false), 2000);
  }

  if (step === "idle") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Ativar autenticação em duas etapas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Use um app autenticador (Google Authenticator, Authy, 1Password) para gerar
            códigos de 6 dígitos que serão solicitados em operações sensíveis.
          </p>
          <Button onClick={startSetup} disabled={loading}>
            {loading ? "Iniciando..." : "Começar"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (step === "scan" && qrDataUrl) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Passo 1 de 3 — Escanear QR Code</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col items-center gap-3">
            <Image
              src={qrDataUrl}
              alt="QR Code 2FA"
              width={240}
              height={240}
              unoptimized
              className="border rounded"
            />
            {secret && (
              <details className="text-sm text-muted-foreground">
                <summary className="cursor-pointer">
                  Não consegue escanear? Digite manualmente
                </summary>
                <code className="block mt-2 p-2 bg-muted rounded font-mono text-xs break-all">
                  {secret}
                </code>
              </details>
            )}
          </div>
          <Button onClick={() => setStep("confirm")} className="w-full">
            Já escaneei — continuar
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (step === "confirm") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Passo 2 de 3 — Confirmar código</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Abra o app autenticador e digite o código de 6 dígitos que aparece:
          </p>
          <div>
            <Label htmlFor="otp-code">Código de 6 dígitos</Label>
            <Input
              id="otp-code"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="font-mono text-2xl text-center tracking-widest"
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("scan")}>
              Voltar
            </Button>
            <Button
              onClick={confirmEnable}
              disabled={loading || code.length !== 6}
              className="flex-1"
            >
              {loading ? "Confirmando..." : "Confirmar e ativar"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (step === "recovery") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Passo 3 de 3 — Salve seus códigos de recuperação</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 border-2 border-amber-400 bg-amber-50 rounded">
            <p className="text-sm font-semibold text-amber-900">
              ⚠ Guarde estes códigos AGORA. Eles não serão mostrados novamente.
            </p>
            <p className="text-xs text-amber-800 mt-1">
              Use em caso de perder seu dispositivo autenticador. Cada código só pode ser usado uma vez.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 font-mono text-sm p-4 bg-muted rounded">
            {recoveryCodes.map((c) => (
              <div key={c}>{c}</div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={copyRecovery} className="flex-1">
              {copied ? (
                <>
                  <Check className="h-4 w-4 mr-1" /> Copiado
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-1" /> Copiar códigos
                </>
              )}
            </Button>
            <Button onClick={finishSetup} className="flex-1">
              Eu guardei — concluir
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="py-8 text-center">
        <div className="text-lg font-semibold text-green-600">
          ✓ 2FA ativado com sucesso
        </div>
      </CardContent>
    </Card>
  );
}
