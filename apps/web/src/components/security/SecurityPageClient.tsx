"use client";
import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TwoFactorSetup } from "./TwoFactorSetup";
import { DevicesSection } from "./DevicesSection";
import { use2FA } from "@/hooks/use2FA";
import { useElevation } from "@/hooks/useElevation";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Shield, ShieldCheck, ShieldOff, KeyRound } from "lucide-react";

export function SecurityPageClient() {
  const { status, loading, refresh } = use2FA();
  const { elevated, scopes, revoke } = useElevation();
  const [setupOpen, setSetupOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePwd, setDisablePwd] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [disableLoading, setDisableLoading] = useState(false);

  async function handleDisable() {
    setDisableLoading(true);
    try {
      const res = await fetch("/api/security/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password: disablePwd, code: disableCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Falha ao desativar");
        return;
      }
      toast.success("2FA desativado");
      await refresh();
      setDisableOpen(false);
      setDisablePwd("");
      setDisableCode("");
    } finally {
      setDisableLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display tracking-tight text-2xl font-semibold">Segurança</h1>
          <p className="text-sm text-muted-foreground">
            Proteja sua conta com autenticação em duas etapas e revise atividade recente.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/settings/seguranca/audit-log">
            <KeyRound className="h-4 w-4 mr-1" />
            Registro de atividade
          </Link>
        </Button>
      </div>

      {/* Status de elevation */}
      {elevated && (
        <Card className="border-green-300 bg-green-50">
          <CardContent className="py-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <ShieldCheck className="h-4 w-4 text-green-600" />
              <span className="font-medium">Identidade confirmada</span>
              <span className="text-muted-foreground">· Scopes: {scopes.join(", ")}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={revoke}>
              Revogar
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 2FA Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Autenticação em duas etapas
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && <p className="text-sm text-muted-foreground">Carregando...</p>}
          {!loading && status && status.enabled && (
            <>
              <div className="flex items-center gap-3">
                <Badge variant="default" className="bg-green-600">
                  Ativo
                </Badge>
                <span className="text-sm text-muted-foreground">
                  Desde{" "}
                  {status.enrolledAt
                    ? new Date(status.enrolledAt).toLocaleDateString("pt-BR")
                    : "—"}
                </span>
              </div>
              <div className="text-sm space-y-1">
                <div>
                  <span className="text-muted-foreground">Último uso:</span>{" "}
                  {status.lastUsedAt
                    ? new Date(status.lastUsedAt).toLocaleString("pt-BR")
                    : "nunca"}
                </div>
                <div>
                  <span className="text-muted-foreground">
                    Códigos de recuperação:
                  </span>{" "}
                  {status.recoveryCodesRemaining} de 10 restantes
                </div>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDisableOpen(true)}
              >
                <ShieldOff className="h-4 w-4 mr-1" />
                Desativar 2FA
              </Button>
            </>
          )}
          {!loading && status && !status.enabled && (
            <>
              <div className="flex items-center gap-3">
                <Badge variant="secondary">Não configurado</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                O módulo Financeiro exige 2FA. Ative agora para liberar acesso.
              </p>
              <Button onClick={() => setSetupOpen(true)}>Configurar 2FA</Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Trusted devices */}
      <DevicesSection />

      {/* Setup dialog */}
      <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Configurar 2FA</DialogTitle>
          </DialogHeader>
          <TwoFactorSetup
            onComplete={async () => {
              await refresh();
              setTimeout(() => setSetupOpen(false), 1500);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Disable dialog */}
      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desativar autenticação 2FA</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded text-sm">
              ⚠ Desativar 2FA reduz a segurança da conta e bloqueia acesso ao módulo
              Financeiro. Confirme sua senha e o código atual para prosseguir.
            </div>
            <div>
              <Label htmlFor="d-pwd">Senha</Label>
              <Input
                id="d-pwd"
                type="password"
                value={disablePwd}
                onChange={(e) => setDisablePwd(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="d-code">Código 2FA</Label>
              <Input
                id="d-code"
                inputMode="numeric"
                maxLength={6}
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ""))}
                className="font-mono text-center tracking-widest"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisableOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDisable}
              disabled={disableLoading || !disablePwd || disableCode.length !== 6}
            >
              {disableLoading ? "Desativando..." : "Desativar 2FA"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
