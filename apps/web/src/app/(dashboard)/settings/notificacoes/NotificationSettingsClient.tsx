"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  USER_NOTIF_CATEGORY_HINT,
  USER_NOTIF_CATEGORY_LABEL,
} from "@/lib/notifications/user-channels-shared";
import {
  EventChannelMatrix,
  type MatrixValues,
} from "@/components/notifications/EventChannelMatrix";
import type { DealNotifEvent } from "@/lib/notifications/deal-events-shared";

interface ResolvedConfig {
  events: MatrixValues;
  formReminder: { enabled: boolean; days: number[] };
}

interface Candidate {
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
  hasPhone: boolean;
}

/**
 * Categoria coberta pela seleção de "quem mais recebe". Começa só em
 * `deal_updates` (andamento do negócio) — foi o caso pedido, e ampliar depois
 * é acrescentar entrada aqui, não mexer no motor.
 */
const CATEGORIA = "deal_updates" as const;

export default function NotificationSettingsClient() {
  const [resolved, setResolved] = useState<ResolvedConfig | null>(null);
  const [daysText, setDaysText] = useState("");
  const [savingDays, setSavingDays] = useState(false);
  // Kill switch do canal WhatsApp da equipe. Só existe como divergência no
  // blob cru — ausente significa "não interfere", daí o default true.
  const [userChannelsEnabled, setUserChannelsEnabled] = useState(true);
  const [candidatos, setCandidatos] = useState<Candidate[]>([]);
  const [escolhidos, setEscolhidos] = useState<string[]>([]);
  const [salvandoEscolhidos, setSalvandoEscolhidos] = useState(false);

  async function load() {
    const res = await fetch("/api/org/notification-settings", {
      credentials: "include",
    });
    if (!res.ok) {
      toast.error("Falha ao carregar configurações de notificação");
      return;
    }
    const data = await res.json();
    setResolved(data.resolved);
    setDaysText((data.resolved?.formReminder?.days ?? []).join(", "));
    setUserChannelsEnabled(
      data.settings?.settingsJson?.userChannels?.enabled !== false
    );
    setCandidatos(data.recipientCandidates ?? []);
    setEscolhidos(
      data.settings?.settingsJson?.userRecipients?.events?.[CATEGORIA] ?? []
    );
  }

  useEffect(() => {
    void load();
  }, []);

  async function patch(body: unknown): Promise<boolean> {
    const res = await fetch("/api/org/notification-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Falha ao salvar");
      return false;
    }
    setResolved(data.resolved);
    return true;
  }

  async function toggleEvent(
    ev: DealNotifEvent,
    channel: "email" | "whatsapp",
    value: boolean
  ) {
    if (!resolved) return;
    // Optimistic
    setResolved({
      ...resolved,
      events: {
        ...resolved.events,
        [ev]: { broker: { ...resolved.events[ev].broker, [channel]: value } },
      },
    });
    const ok = await patch({ events: { [ev]: { broker: { [channel]: value } } } });
    if (!ok) void load();
  }

  async function saveReminderDays() {
    const days = daysText
      .split(/[,;\s]+/)
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 60);
    if (days.length === 0) {
      toast.error("Informe ao menos um dia entre 1 e 60 (ex.: 2, 5)");
      return;
    }
    setSavingDays(true);
    try {
      const ok = await patch({ formReminder: { days } });
      if (ok) toast.success("Régua do lembrete atualizada");
    } finally {
      setSavingDays(false);
    }
  }

  if (!resolved) {
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Eventos enviados aos corretores
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            E-mail sai com a marca da imobiliária; WhatsApp depende do
            assistente (Newton) estar habilitado e do corretor ter aceitado o
            canal no cadastro.
          </p>
        </CardHeader>
        <CardContent>
          <EventChannelMatrix values={resolved.events} onToggle={toggleEvent} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lembrete de preenchimento</CardTitle>
          <p className="text-sm text-muted-foreground">
            Cobrança automática quando o formulário fica aberto sem conclusão.
            Os corretores do negócio recebem o lembrete com o link do
            formulário nos dias configurados após a criação.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm">Lembrete automático ativo</span>
            <Switch
              checked={resolved.formReminder.enabled}
              onCheckedChange={(v) => void patch({ formReminder: { enabled: v } })}
            />
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-sm block mb-1" htmlFor="reminder-days">
                Dias após a criação (separados por vírgula)
              </label>
              <Input
                id="reminder-days"
                placeholder="2, 5"
                value={daysText}
                onChange={(e) => setDaysText(e.target.value)}
                disabled={!resolved.formReminder.enabled}
              />
            </div>
            <Button
              onClick={saveReminderDays}
              disabled={savingDays || !resolved.formReminder.enabled}
            >
              {savingDays ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Avisos no WhatsApp da equipe
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Cada pessoa da equipe ativa os próprios avisos no perfil dela. Aqui
            você pode <strong>desligar</strong> o canal para todo mundo de uma
            vez — e, no bloco abaixo, escolher quem deve receber mesmo sem ter
            ativado.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <span className="text-sm">
              Permitir que a equipe receba avisos por WhatsApp
            </span>
            <Switch
              checked={userChannelsEnabled}
              onCheckedChange={(v) => {
                setUserChannelsEnabled(v);
                void patch({ userChannels: { enabled: v } }).then((ok) => {
                  if (!ok) setUserChannelsEnabled(!v);
                });
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Quem mais recebe — {USER_NOTIF_CATEGORY_LABEL[CATEGORIA]}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Por padrão só o <strong>responsável pelo negócio</strong> recebe
            esses avisos. Marque aqui quem precisa saber de{" "}
            <strong>todos os negócios</strong> da imobiliária — típico de quem
            acompanha o processo inteiro sem ser dono de nenhum.
          </p>
          <p className="text-sm text-muted-foreground">
            {USER_NOTIF_CATEGORY_HINT[CATEGORIA]} Marcar alguém aqui{" "}
            <strong>liga o WhatsApp dela</strong> — fica registrado que foi você
            quem ativou, e ela pode desligar no próprio perfil quando quiser.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {candidatos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            candidatos.map((c) => {
              const marcado = escolhidos.includes(c.userId);
              return (
                <label
                  key={c.userId}
                  className={`flex items-start gap-3 rounded px-1 py-1 -mx-1 ${
                    c.hasPhone
                      ? "cursor-pointer hover:bg-muted/50"
                      : "cursor-not-allowed opacity-60"
                  }`}
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={marcado}
                    disabled={!c.hasPhone || salvandoEscolhidos}
                    onCheckedChange={(v) => {
                      const proximo = v === true
                        ? [...escolhidos, c.userId]
                        : escolhidos.filter((id) => id !== c.userId);
                      const anterior = escolhidos;
                      setEscolhidos(proximo);
                      setSalvandoEscolhidos(true);
                      void patch({
                        userRecipients: { events: { [CATEGORIA]: proximo } },
                      })
                        .then((ok) => {
                          if (!ok) setEscolhidos(anterior);
                          else if (v === true) {
                            toast.success(
                              `${c.name ?? "Usuário"} passa a receber no WhatsApp`
                            );
                          }
                        })
                        .finally(() => setSalvandoEscolhidos(false));
                    }}
                  />
                  <span className="text-sm leading-tight">
                    {c.name ?? c.email ?? c.userId}
                    <span className="text-muted-foreground"> · {c.role}</span>
                    {!c.hasPhone && (
                      // Sem este aviso o admin marcaria e nada aconteceria —
                      // é o tipo de silêncio que já custou caro neste fluxo.
                      <span className="block text-xs text-amber-600">
                        Sem telefone cadastrado. Ela precisa preencher no perfil
                        antes de poder receber.
                      </span>
                    )}
                  </span>
                </label>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
