"use client";

import {
  AlertTriangle,
  BellOff,
  KeyRound,
  Mail,
  MessageCircle,
  Pencil,
  Trash2,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatBrPhone } from "@/lib/validators/phone-br";
import { PAPEL_LABEL } from "./corretor-form-schema";
import { maskDoc, type Corretor } from "./types";

interface CorretorCardProps {
  c: Corretor;
  /** Lente ativa na org — controla se dados de recebimento aparecem/alarmam. */
  pagadoriaEnabled: boolean;
  inactive?: boolean;
  onEdit: () => void;
  onDeactivate?: () => void;
  onReactivate?: () => void;
  onRequestCompletion?: () => void;
  onNotifyPatch: (patch: Partial<Corretor>) => void;
}

export function CorretorCard({
  c,
  pagadoriaEnabled,
  inactive,
  onEdit,
  onDeactivate,
  onReactivate,
  onRequestCompletion,
  onNotifyPatch,
}: CorretorCardProps) {
  // `pendingFields` é sempre sobre dados de RECEBIMENTO — só é motivo de
  // alarme visual quando a lente de pagadoria está ligada na org.
  const paymentPending = !c.active && (c.pendingFields ?? []).length > 0;
  const showPaymentAlert = pagadoriaEnabled && paymentPending;
  const hasContact = Boolean(c.email || c.phone);
  const silenced = c.notifyOptOut;
  // Mesmos canais que /request-completion considera viáveis (ver route.ts) —
  // inclusive o gate de notifyOptOut no WhatsApp.
  const completionViable =
    Boolean(c.email) || Boolean(c.notifyByWhatsapp && c.phone && !c.notifyOptOut);

  return (
    <Card className={cn(showPaymentAlert && "border-warning/40 bg-warning/5", inactive && "opacity-60")}>
      <CardContent className="flex items-center justify-between p-4 gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{c.label}</span>
            {c.papel && (
              <Badge variant="outline" className="text-xs">
                {PAPEL_LABEL[c.papel] ?? c.papel}
              </Badge>
            )}
            {c.creci && (
              <Badge variant="outline" className="text-xs">
                CRECI {c.creci}
              </Badge>
            )}

            {pagadoriaEnabled ? (
              <>
                <Badge variant={hasContact ? "secondary" : "outline"} className="text-xs">
                  {hasContact ? "Cadastro ok" : "Cadastro incompleto"}
                </Badge>
                {paymentPending ? (
                  <Badge
                    variant="outline"
                    className="gap-1 text-xs border-warning/40 bg-warning/10 text-warning"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    Pagamento pendente
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">
                    Pagamento ok
                  </Badge>
                )}
              </>
            ) : (
              hasContact && (
                <Badge variant="secondary" className="text-xs">
                  Notificações ativas
                </Badge>
              )
            )}

            {inactive && (
              <Badge variant="outline" className="text-xs">
                Inativo
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
            <span className="font-mono">{maskDoc(c.cpfCnpj)}</span>
            {c.email && <span>{c.email}</span>}
            {c.phone && <span>{formatBrPhone(c.phone)}</span>}
            {pagadoriaEnabled && (
              <span className="flex items-center gap-1">
                {c.recipientType === "pix_external" ? (
                  <>
                    <KeyRound className="h-3 w-3" /> PIX
                  </>
                ) : c.walletId ? (
                  <>
                    <Wallet className="h-3 w-3" /> Asaas
                  </>
                ) : null}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2">
                {silenced ? (
                  <BellOff className="h-4 w-4 text-destructive" />
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => onNotifyPatch({ notifyByEmail: !c.notifyByEmail })}
                      aria-label={`Email ${c.notifyByEmail ? "ligado" : "desligado"}`}
                    >
                      <Mail
                        className={cn(
                          "h-4 w-4",
                          c.notifyByEmail ? "text-success" : "text-muted-foreground/40"
                        )}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => onNotifyPatch({ notifyByWhatsapp: !c.notifyByWhatsapp })}
                      aria-label={`WhatsApp ${c.notifyByWhatsapp ? "ligado" : "desligado"}`}
                    >
                      <MessageCircle
                        className={cn(
                          "h-4 w-4",
                          c.notifyByWhatsapp ? "text-success" : "text-muted-foreground/40"
                        )}
                      />
                    </button>
                  </>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent>
              {silenced
                ? "Corretor silenciou todas as notificações"
                : "Canais de notificação deste corretor"}
            </TooltipContent>
          </Tooltip>

          <div className="flex gap-1">
            {showPaymentAlert && onRequestCompletion && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onRequestCompletion}
                      disabled={!completionViable}
                    >
                      Pedir dados
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {completionViable
                    ? "Enviar link pro corretor completar os dados de recebimento"
                    : "Cadastre email, ou telefone com WhatsApp ligado, antes de pedir os dados"}
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Editar">
                  <Pencil className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Editar</TooltipContent>
            </Tooltip>
            {inactive ? (
              <Button variant="ghost" size="sm" onClick={onReactivate} className="text-success">
                Reativar
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={onDeactivate} aria-label="Desativar">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Desativar</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
