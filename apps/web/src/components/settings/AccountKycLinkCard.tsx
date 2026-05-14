"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Link as LinkIcon,
  ExternalLink,
  Send,
  Info,
  Copy,
  Check,
  RotateCcw,
  MessageCircle,
  Mail,
} from "lucide-react";

/**
 * Card "KYC pelo titular" — exibe a URL pública hospedada pelo Contractmaker
 * (/kyc/[token]) pra admin copiar e mandar via WhatsApp/email/etc. Não
 * depende do email de ativação do Asaas — usa a apiKey já armazenada
 * pra proxiar uploads server-side.
 *
 * Fallbacks (linha secundária): abrir painel Asaas + reenviar email Asaas
 * (1× via API). Sem precisar pedir forward.
 */
export function AccountKycLinkCard({
  accountId,
  email,
  accountName,
  initialKycToken,
}: {
  accountId: string;
  email: string | null;
  accountName: string | null;
  initialKycToken: string | null;
}) {
  const [token, setToken] = useState<string | null>(initialKycToken);
  const [submittingRotate, setSubmittingRotate] = useState(false);
  const [submittingResend, setSubmittingResend] = useState(false);
  const [copied, setCopied] = useState(false);

  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  const publicLink = token ? `${origin}/kyc/${token}` : null;

  async function handleGenerate() {
    setSubmittingRotate(true);
    try {
      const res = await fetch(
        `/api/financeiro/accounts/${accountId}/kyc-token`,
        { method: "POST", credentials: "include" }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Falha ao gerar link");
        return;
      }
      setToken(data.kycToken);
      toast.success(
        token
          ? "Link rotacionado — o antigo deixou de funcionar"
          : "Link gerado"
      );
    } finally {
      setSubmittingRotate(false);
    }
  }

  async function handleCopy() {
    if (!publicLink) return;
    try {
      await navigator.clipboard.writeText(publicLink);
      setCopied(true);
      toast.success("Link copiado");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Falha ao copiar — selecione manualmente");
    }
  }

  async function handleResendEmail() {
    setSubmittingResend(true);
    try {
      const res = await fetch(
        `/api/financeiro/accounts/${accountId}/resend-activation-link`,
        { method: "POST", credentials: "include" }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Falha ao reenviar");
        return;
      }
      toast.success(
        email
          ? `Email Asaas reenviado pra ${email}`
          : "Email Asaas reenviado"
      );
    } finally {
      setSubmittingResend(false);
    }
  }

  function whatsappShareUrl(): string {
    if (!publicLink) return "";
    const lines = [
      `Olá! Para concluir o cadastro da sua subconta${
        accountName ? ` (${accountName})` : ""
      } na nossa pagadoria, envie os documentos por este link:`,
      "",
      publicLink,
      "",
      "É rápido e mobile-friendly. Qualquer dúvida, me chame.",
    ];
    return `https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`;
  }

  function emailShareUrl(): string {
    if (!publicLink) return "";
    const subject = `Envio de documentos KYC — ${accountName ?? "subconta"}`;
    const body = [
      `Olá,`,
      "",
      `Para concluir o cadastro da subconta de pagadoria, envie os documentos por este link:`,
      publicLink,
      "",
      `Abraço,`,
    ].join("\n");
    return `mailto:${email ?? ""}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(body)}`;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <LinkIcon className="h-4 w-4" />
          Link de KYC para o titular
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Envie este link para
          {accountName ? (
            <>
              {" "}<strong>{accountName}</strong>{" "}
            </>
          ) : (
            " o titular "
          )}
          enviar os documentos diretamente. Hospedado pelo Contractmaker, não
          exige login nem que o titular receba qualquer email do Asaas.
        </p>

        {publicLink ? (
          <div className="border rounded p-2.5 bg-emerald-50/50 border-emerald-200 space-y-2">
            <div className="text-xs font-medium text-emerald-900 flex items-center gap-1">
              <Check className="h-3.5 w-3.5" /> Link ativo
            </div>
            <div className="font-mono text-xs break-all bg-white border rounded p-2">
              {publicLink}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" onClick={handleCopy} className="gap-1.5">
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copied ? "Copiado" : "Copiar"}
              </Button>
              <Button
                asChild
                size="sm"
                variant="outline"
                className="gap-1.5"
              >
                <a
                  href={whatsappShareUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle className="h-4 w-4" />
                  WhatsApp
                </a>
              </Button>
              <Button
                asChild
                size="sm"
                variant="outline"
                className="gap-1.5"
              >
                <a href={emailShareUrl()}>
                  <Mail className="h-4 w-4" />
                  Email
                </a>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleGenerate}
                disabled={submittingRotate}
                className="gap-1.5 text-muted-foreground"
              >
                <RotateCcw className="h-4 w-4" />
                {submittingRotate ? "Rotacionando…" : "Gerar novo"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="border rounded p-3 bg-amber-50 border-amber-200 space-y-2">
            <p className="text-xs text-amber-900">
              Esta conta ainda não tem link público. Gere um agora — você vai
              poder copiar e enviar via WhatsApp/email assim que aparecer.
            </p>
            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={submittingRotate}
              className="gap-1.5"
            >
              <LinkIcon className="h-4 w-4" />
              {submittingRotate ? "Gerando…" : "Gerar link"}
            </Button>
          </div>
        )}

        <div className="border-t pt-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            Alternativas (caso prefira o painel oficial do Asaas):
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <a
                href="https://app.asaas.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-4 w-4" />
                Painel Asaas
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleResendEmail}
              disabled={submittingResend}
              className="gap-1.5"
            >
              <Send className="h-4 w-4" />
              {submittingResend
                ? "Enviando…"
                : email
                  ? `Reenviar email Asaas pra ${email}`
                  : "Reenviar email Asaas"}
            </Button>
          </div>
        </div>

        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/40 rounded p-2">
          <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <div>
            O link público é guess-resistant (256 bits de entropia) e válido
            até você gerar um novo. Os arquivos vão direto pro Asaas — não
            ficam armazenados no Contractmaker.
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
