"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  Bell,
  CheckCircle2,
  XCircle,
  FileCheck2,
  AlertTriangle,
  Wallet,
  LifeBuoy,
  FileText,
  Clock,
  MessageCircle,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useNotifications, type NotificationRow } from "@/hooks/useNotifications";

function iconForType(type: string) {
  switch (type) {
    case "certidao_batch_complete":
      return <FileCheck2 className="h-4 w-4 text-green-600 shrink-0" />;
    case "certidao_ready":
      return <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />;
    case "certidao_failed":
      return <XCircle className="h-4 w-4 text-red-600 shrink-0" />;
    case "dual_approval_pending":
      return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />;
    case "dual_approval_resolved":
      return <CheckCircle2 className="h-4 w-4 text-blue-600 shrink-0" />;
    case "charge_overdue":
      return <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />;
    case "transfer_done":
      return <Wallet className="h-4 w-4 text-green-600 shrink-0" />;
    case "transfer_failed":
      return <XCircle className="h-4 w-4 text-red-600 shrink-0" />;
    case "support_answered":
      return <LifeBuoy className="h-4 w-4 text-primary shrink-0" />;
    // Tipos que existiam sem ícone próprio e caíam no sino genérico.
    case "certidao_problem":
    case "certidao_data_missing":
      return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />;
    case "form_completed":
    case "participant_completed":
      return <FileCheck2 className="h-4 w-4 text-emerald-600 shrink-0" />;
    case "deal_stage_change":
    case "deal_contract_ready":
    case "deal_contract_sent":
      return <FileText className="h-4 w-4 text-blue-600 shrink-0" />;
    case "deal_form_reminder":
      return <Clock className="h-4 w-4 text-amber-500 shrink-0" />;
    // SLA do pipeline: estouro individual (vermelho) e digest diário (âmbar).
    case "deal_sla_breached":
      return <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />;
    case "deal_sla_digest":
      return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />;
    case "envelope_signed":
    case "proposal_completed":
    case "proposal_accepted_party":
    case "proposal_signed_proponente":
      return <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />;
    // Entrega é andamento, não desfecho — ícone neutro pra não competir com os
    // marcos que pedem ação.
    case "proposal_delivered":
      return <Send className="h-4 w-4 text-blue-600 shrink-0" />;
    // O lead subiu documentos pela página pública da proposta.
    case "proposal_documents_received":
      return <FileText className="h-4 w-4 text-blue-600 shrink-0" />;
    case "envelope_refused":
    case "proposal_refused":
      return <XCircle className="h-4 w-4 text-red-600 shrink-0" />;
    // Âmbar, não vermelho: cancelamento externo libera pra reenvio — é "sua
    // vez", não desfecho ruim (mesma semântica do badge "Envio cancelado").
    case "proposal_send_canceled":
      return <Ban className="h-4 w-4 text-amber-600 shrink-0" />;
    case "envelope_email_failed":
    case "proposal_email_failed":
    case "contract_generation_failed":
      return <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />;
    case "proposal_expired":
      return <Clock className="h-4 w-4 text-muted-foreground shrink-0" />;
    case "charge_created":
    case "charge_paid":
      return <Wallet className="h-4 w-4 text-green-600 shrink-0" />;
    case "charge_due_soon":
      return <Clock className="h-4 w-4 text-amber-500 shrink-0" />;
    case "ai_budget_threshold":
      return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />;
    case "survey_detractor":
      return <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />;
    case "survey_response":
      return <MessageCircle className="h-4 w-4 text-primary shrink-0" />;
    default:
      return <Bell className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin}min atrás`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h atrás`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d atrás`;
  return d.toLocaleDateString("pt-BR");
}

export function NotificationsBell() {
  const { items, unreadCount, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const handleClick = async (n: NotificationRow) => {
    await markRead(n.id);
    if (n.linkUrl) {
      setOpen(false);
      router.push(n.linkUrl);
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label="Notificações"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-0.5 -right-0.5 h-4 min-w-4 rounded-full px-1 text-[10px] flex items-center justify-center"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[400px] sm:w-[440px] flex flex-col">
        <SheetHeader>
          <div className="flex items-center justify-between">
            <SheetTitle>Notificações</SheetTitle>
            {unreadCount > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={markAllRead}
                className="text-xs"
              >
                Marcar todas como lidas
              </Button>
            )}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6 mt-4">
          {items.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-10">
              <Bell className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p>Sem notificações</p>
              <p className="text-xs mt-1">
                Você será avisado quando certidões assíncronas ficarem prontas.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {items.map((n) => (
                <li
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={`cursor-pointer rounded border p-3 hover:bg-muted/30 transition-colors ${
                    !n.read ? "bg-blue-50/40 border-blue-200" : "bg-background"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {iconForType(n.type)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium break-words">{n.title}</p>
                        {!n.read && (
                          <span className="inline-block h-2 w-2 rounded-full bg-blue-500 shrink-0 mt-1.5" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 break-words">
                        {n.body}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {formatRelative(n.createdAt)}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
