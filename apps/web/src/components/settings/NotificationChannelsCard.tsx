"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { MessageCircle } from "lucide-react";
import {
  USER_NOTIF_CATEGORIES,
  USER_NOTIF_CATEGORY_HINT,
  USER_NOTIF_CATEGORY_LABEL,
  type UserNotifCategory,
} from "@/lib/notifications/user-channels-shared";

type Toggles = Partial<Record<UserNotifCategory, { whatsapp?: boolean }>>;

interface PrefsResponse {
  events: Toggles;
  whatsappOptInAt: string | null;
  phone: string | null;
  orgBlocked: boolean;
  orgBlockedCategories: string[];
}

/**
 * Opt-in do usuário para receber avisos do sistema no WhatsApp.
 *
 * Só o próprio usuário liga — a imobiliária pode desligar, nunca ligar por
 * ele (o número é PII pessoal). Sem telefone no perfil, os toggles ficam
 * travados: é o mesmo campo `phone` do card de dados pessoais acima.
 */
export function NotificationChannelsCard() {
  const [prefs, setPrefs] = useState<PrefsResponse | null>(null);
  const [saving, setSaving] = useState<UserNotifCategory | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/me/notification-preferences")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: PrefsResponse | null) => {
        if (alive && data) setPrefs(data);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  async function toggle(category: UserNotifCategory, value: boolean) {
    if (!prefs) return;
    setSaving(category);
    // Otimista: reverte se o servidor recusar.
    const previous = prefs.events;
    setPrefs({
      ...prefs,
      events: { ...previous, [category]: { whatsapp: value } },
    });
    try {
      const res = await fetch("/api/me/notification-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: { [category]: { whatsapp: value } } }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPrefs({ ...prefs, events: previous });
        toast.error(data.error ?? "Falha ao salvar preferência");
        return;
      }
      setPrefs((p) =>
        p ? { ...p, events: data.events, whatsappOptInAt: data.whatsappOptInAt } : p
      );
    } catch {
      setPrefs({ ...prefs, events: previous });
      toast.error("Falha ao salvar preferência");
    } finally {
      setSaving(null);
    }
  }

  const semTelefone = prefs !== null && !prefs.phone;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4" />
          Avisos no WhatsApp
        </CardTitle>
        <CardDescription>
          Receba avisos do sistema pelo assistente, no telefone cadastrado no seu
          perfil. As mensagens são encaminhadas ao assistente — não há
          confirmação de entrega.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {semTelefone && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Cadastre seu telefone no card &quot;Dados pessoais&quot; acima para
            ativar os avisos.
          </p>
        )}
        {prefs?.orgBlocked && (
          <p className="rounded-md border border-muted bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            A sua imobiliária desativou os avisos por WhatsApp para toda a
            equipe. Suas escolhas ficam salvas, mas nada é enviado.
          </p>
        )}

        <div className="space-y-3">
          {USER_NOTIF_CATEGORIES.map((category) => {
            const blocked = prefs?.orgBlockedCategories.includes(category);
            return (
              <div
                key={category}
                className="flex items-start justify-between gap-4"
              >
                <div className="space-y-0.5">
                  <Label
                    htmlFor={`notif-${category}`}
                    className="text-sm font-medium"
                  >
                    {USER_NOTIF_CATEGORY_LABEL[category]}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {USER_NOTIF_CATEGORY_HINT[category]}
                    {blocked && " · desativado pela imobiliária"}
                  </p>
                </div>
                <Switch
                  id={`notif-${category}`}
                  checked={prefs?.events?.[category]?.whatsapp === true}
                  disabled={!prefs || semTelefone || saving === category}
                  onCheckedChange={(v) => toggle(category, v)}
                />
              </div>
            );
          })}
        </div>

        {prefs?.whatsappOptInAt && (
          <p className="text-xs text-muted-foreground">
            Você autorizou o envio em{" "}
            {new Date(prefs.whatsappOptInAt).toLocaleDateString("pt-BR", {
              timeZone: "America/Sao_Paulo",
            })}
            . Desligar todas as opções revoga a autorização.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
