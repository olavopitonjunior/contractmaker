"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Mail,
  ExternalLink,
  Send,
  CheckCircle2,
  Info,
  AlertCircle,
} from "lucide-react";

/**
 * Card "KYC pelo titular" — fluxo 100% por email. A Asaas envia o link de
 * cadastro pro `loginEmail` da subconta (auto na criação + 1 reenvio via API).
 * Não há como obter a URL via API pra subcontas non-BaaS.
 *
 * Mostra:
 *  - Email cadastrado
 *  - Status do envio (Enviado em DD/MM, Reenviado em DD/MM, ou Reenvio esgotado)
 *  - Botão "Reenviar email Asaas" (desativado quando já reenviou)
 *  - Link direto pro painel Asaas (app.asaas.com)
 */
export function AccountKycLinkCard({
  accountId,
  email,
  accountName,
  initialSentAt,
  initialResentAt,
}: {
  accountId: string;
  email: string | null;
  accountName: string | null;
  initialSentAt: string | null;
  initialResentAt: string | null;
}) {
  const [sentAt] = useState<string | null>(initialSentAt);
  const [resentAt, setResentAt] = useState<string | null>(initialResentAt);
  const [submitting, setSubmitting] = useState(false);

  async function handleResend() {
    setSubmitting(true);
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
      setResentAt(data.resentAt);
      toast.success(
        email
          ? `Email reenviado para ${email}`
          : "Email reenviado pelo Asaas"
      );
    } finally {
      setSubmitting(false);
    }
  }

  const fmt = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

  const sent = fmt(sentAt);
  const resent = fmt(resentAt);
  const resendExhausted = resentAt !== null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Mail className="h-4 w-4" />
          Onboarding KYC por email
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          A Asaas envia o link de cadastro
          {accountName ? (
            <>
              {" "}para <strong>{accountName}</strong>{" "}
            </>
          ) : (
            " para o titular "
          )}
          no email cadastrado. O titular acessa o painel, faz a selfie ao vivo
          e envia os documentos (RG, comprovante, contrato social) por lá.
        </p>

        <div className="border rounded p-3 space-y-2">
          <div>
            <div className="text-xs text-muted-foreground">
              Email cadastrado
            </div>
            <div className="font-mono text-sm">
              {email ?? <span className="text-muted-foreground">—</span>}
            </div>
          </div>

          <div className="border-t pt-2 text-xs space-y-1">
            {sent ? (
              <div className="flex items-center gap-1.5 text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Enviado em {sent}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-amber-700">
                <AlertCircle className="h-3.5 w-3.5" />
                Email ainda não enviado
              </div>
            )}
            {resent && (
              <div className="flex items-center gap-1.5 text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Reenviado em {resent}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={handleResend}
            disabled={submitting || resendExhausted}
            className="gap-1.5"
            title={
              resendExhausted
                ? "Asaas só permite 1 reenvio via API"
                : undefined
            }
          >
            <Send className="h-4 w-4" />
            {submitting
              ? "Enviando…"
              : resendExhausted
                ? "Reenvio esgotado"
                : "Reenviar email Asaas"}
          </Button>
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <a
              href="https://app.asaas.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="h-4 w-4" />
              Abrir painel Asaas
            </a>
          </Button>
        </div>

        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/40 rounded p-2">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div>
            A Asaas só permite <strong>1 reenvio por subconta</strong> via API
            (o primeiro envio é automático na criação). Se o titular perder os
            dois, ele pode usar &quot;Esqueci minha senha&quot; no painel Asaas
            com o email acima.
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
