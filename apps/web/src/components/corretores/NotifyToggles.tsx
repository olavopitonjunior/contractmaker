"use client";

import type { ReactNode } from "react";
import { BellOff, Mail, MessageCircle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface NotifyPatch {
  notifyByEmail?: boolean;
  notifyByWhatsapp?: boolean;
  notifyOptOut?: boolean;
}

interface NotifyTogglesProps {
  notifyByEmail: boolean;
  notifyByWhatsapp: boolean;
  notifyOptOut: boolean;
  /** Corretor tem email cadastrado — pré-requisito do canal por email. */
  hasEmail: boolean;
  /** Corretor tem telefone cadastrado — pré-requisito do canal por WhatsApp. */
  hasPhone: boolean;
  onChange: (patch: NotifyPatch) => void;
}

/**
 * Switches de preferência de notificação do corretor, com tooltip explicando
 * o pré-requisito (email/telefone cadastrado) quando o canal está desabilitado.
 */
export function NotifyToggles({
  notifyByEmail,
  notifyByWhatsapp,
  notifyOptOut,
  hasEmail,
  hasPhone,
  onChange,
}: NotifyTogglesProps) {
  return (
    <div className="space-y-3">
      <ToggleRow
        icon={<Mail className="h-4 w-4" />}
        label="Receber por email"
        checked={notifyByEmail}
        disabled={!hasEmail}
        tooltip={hasEmail ? undefined : "Cadastre um email pra habilitar este canal"}
        onCheckedChange={(v) => onChange({ notifyByEmail: v })}
      />
      <ToggleRow
        icon={<MessageCircle className="h-4 w-4" />}
        label="Receber por WhatsApp"
        checked={notifyByWhatsapp}
        disabled={!hasPhone}
        tooltip={hasPhone ? undefined : "Cadastre um telefone pra habilitar este canal"}
        onCheckedChange={(v) => onChange({ notifyByWhatsapp: v })}
      />
      <ToggleRow
        icon={<BellOff className="h-4 w-4" />}
        label="Silenciar tudo (opt-out)"
        checked={notifyOptOut}
        onCheckedChange={(v) => onChange({ notifyOptOut: v })}
      />
    </div>
  );
}

function ToggleRow({
  icon,
  label,
  checked,
  disabled,
  tooltip,
  onCheckedChange,
}: {
  icon: ReactNode;
  label: string;
  checked: boolean;
  disabled?: boolean;
  tooltip?: string;
  onCheckedChange: (v: boolean) => void;
}) {
  const row = (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">{icon}</span>
        {label}
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  );

  if (!tooltip) return row;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
