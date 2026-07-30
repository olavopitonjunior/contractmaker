"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  USER_NOTIF_CATEGORIES,
  USER_NOTIF_CATEGORY_LABEL,
  USER_NOTIF_CHANNELS,
  type UserNotifCategory,
  type UserNotifChannel,
} from "@/lib/notifications/user-channels-shared";
import { USER_CHANNEL_REGISTRY } from "@/lib/notifications/user-channels-registry";
import {
  EventChannelMatrix,
  type MatrixValues,
} from "@/components/notifications/EventChannelMatrix";
import {
  PARTY_CAPABLE_EVENTS,
  type DealNotifEvent,
} from "@/lib/notifications/deal-events-shared";

interface ResolvedConfig {
  events: MatrixValues;
  formReminder: { enabled: boolean; days: number[] };
}

type Toggles = { email?: boolean; whatsapp?: boolean };

interface Candidate {
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
  hasPhone: boolean;
  hasEmail: boolean;
  types: Record<string, Toggles>;
}

/** Tipos de cada categoria, derivados do registry — fonte única. */
const TIPOS_POR_CATEGORIA: Record<UserNotifCategory, string[]> = Object.
  fromEntries(
    USER_NOTIF_CATEGORIES.map((c) => [
      c,
      Object.entries(USER_CHANNEL_REGISTRY)
        .filter(([, p]) => p.category === c)
        .map(([t]) => t),
    ])
  ) as Record<UserNotifCategory, string[]>;

/** nenhum | todos | parcial — sem o terceiro a tela mente. */
function estadoCategoria(
  types: Record<string, Toggles>,
  categoria: UserNotifCategory,
  canal: UserNotifChannel
): "nenhum" | "todos" | "parcial" {
  const tipos = TIPOS_POR_CATEGORIA[categoria];
  const ligados = tipos.filter((t) => types[t]?.[canal] === true).length;
  if (ligados === 0) return "nenhum";
  return ligados === tipos.length ? "todos" : "parcial";
}

export default function NotificationSettingsClient() {
  const [resolved, setResolved] = useState<ResolvedConfig | null>(null);
  const [daysText, setDaysText] = useState("");
  const [savingDays, setSavingDays] = useState(false);
  // Kill switch do canal WhatsApp da equipe. Só existe como divergência no
  // blob cru — ausente significa "não interfere", daí o default true.
  const [userChannelsEnabled, setUserChannelsEnabled] = useState(true);
  const [candidatos, setCandidatos] = useState<Candidate[]>([]);
  // A estrutura de avisos é da plataforma; o transporte de WhatsApp hoje é o
  // Newton, que atende um tenant só. E-mail funciona pra qualquer imobiliária.
  const [temAgenteWhatsapp, setTemAgenteWhatsapp] = useState(true);
  const [salvandoMatriz, setSalvandoMatriz] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [detalhado, setDetalhado] = useState<string | null>(null);

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
    setTemAgenteWhatsapp(data.whatsappAgentAvailable !== false);
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
    value: boolean,
    audience: "broker" | "party" = "broker"
  ) {
    if (!resolved) return;
    // Optimistic
    setResolved({
      ...resolved,
      events: {
        ...resolved.events,
        [ev]: {
          ...resolved.events[ev],
          [audience]: { ...resolved.events[ev][audience], [channel]: value },
        },
      },
    });
    const ok = await patch({
      events: { [ev]: { [audience]: { [channel]: value } } },
    });
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

  /**
   * Salva um pedaço da matriz. Manda SÓ o que mudou daquela pessoa — o PATCH
   * funde por tipo, então não é preciso reenviar a matriz inteira.
   */
  async function salvarMatriz(
    userId: string,
    porTipo: Record<string, Toggles>
  ) {
    const antes = candidatos;
    setCandidatos((cs) =>
      cs.map((c) =>
        c.userId === userId
          ? {
              ...c,
              types: Object.fromEntries(
                Object.entries({ ...c.types, ...mesclar(c.types, porTipo) })
              ),
            }
          : c
      )
    );
    setSalvandoMatriz(true);
    const ok = await patch({ userRecipients: { [userId]: porTipo } });
    setSalvandoMatriz(false);
    if (!ok) setCandidatos(antes);
    else void load();
  }

  function mesclar(
    atual: Record<string, Toggles>,
    patchTipos: Record<string, Toggles>
  ): Record<string, Toggles> {
    const out: Record<string, Toggles> = {};
    for (const [t, canais] of Object.entries(patchTipos)) {
      out[t] = { ...(atual[t] ?? {}), ...canais };
    }
    return out;
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
          <CardTitle className="text-base">Partes do negócio</CardTitle>
          <p className="text-sm text-muted-foreground">
            Avisos para o <strong>cliente</strong> (comprador, vendedor, locador
            ou locatário), com a marca da imobiliária e linguagem sem jargão.
            Vêm <strong>desligados</strong>: ligue só o que você quer que chegue
            direto na mão dele.
          </p>
          <p className="text-sm text-muted-foreground">
            Só marcos que o cliente entende sozinho aparecem aqui. Os demais
            eventos continuam exclusivos da equipe e dos corretores.
          </p>
        </CardHeader>
        <CardContent>
          <EventChannelMatrix
            audience="party"
            events={PARTY_CAPABLE_EVENTS}
            values={resolved.events}
            whatsappDisabledReason={
              temAgenteWhatsapp
                ? null
                : "Esta imobiliaria ainda nao tem agente de WhatsApp habilitado, entao esse canal fica indisponivel para as partes. Os avisos por e-mail funcionam normalmente."
            }
            onToggle={(ev, channel, value) =>
              void toggleEvent(ev, channel, value, "party")
            }
          />
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
          <CardTitle className="text-base">Quem mais recebe</CardTitle>
          <p className="text-sm text-muted-foreground">
            Por padrao so o <strong>responsavel pelo negocio</strong> recebe os
            avisos. Aqui voce escolhe quem precisa saber de{" "}
            <strong>todos os negocios</strong> da imobiliaria, e por quais
            canais.
          </p>
          <p className="text-sm text-muted-foreground">
            Marcar aqui <strong>liga o aviso para a pessoa</strong>: fica
            registrado que foi voce quem ativou, e ela pode desligar no proprio
            perfil. O sino continua aparecendo para o time todo,
            independente desta configuracao.
          </p>
        </CardHeader>
        <CardContent className="space-y-1">
          {!temAgenteWhatsapp && (
            // Sem este aviso, o admin marcaria WhatsApp e nada aconteceria: o
            // envio viraria `skipped` num log que ele nunca vê.
            <p className="mb-2 text-xs text-amber-600">
              Esta imobiliaria ainda nao tem agente de WhatsApp habilitado,
              entao esse canal fica indisponivel. Os avisos por e-mail
              funcionam normalmente.
            </p>
          )}
          {candidatos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : (
            candidatos.map((c) => {
              const expandido = aberto === c.userId;
              const totalLigados = Object.values(c.types).filter(
                (t) => t.email || t.whatsapp
              ).length;
              return (
                <div key={c.userId} className="border-b last:border-b-0 py-2">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between text-left"
                    onClick={() => setAberto(expandido ? null : c.userId)}
                  >
                    <span className="text-sm">
                      {c.name ?? c.email ?? c.userId}
                      <span className="text-muted-foreground"> - {c.role}</span>
                      {totalLigados > 0 && (
                        <span className="text-muted-foreground">
                          {" "}
                          - {totalLigados} aviso(s)
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {expandido ? "fechar" : "configurar"}
                    </span>
                  </button>

                  {expandido && (
                    <div className="mt-2 space-y-2 pl-1">
                      {(!c.hasPhone || !c.hasEmail) && (
                        <p className="text-xs text-amber-600">
                          {!c.hasPhone &&
                            "Sem telefone: nao pode receber por WhatsApp. "}
                          {!c.hasEmail && "Sem e-mail cadastrado. "}
                          A pessoa preenche no proprio perfil.
                        </p>
                      )}
                      {USER_NOTIF_CATEGORIES.map((cat) => {
                        const tipos = TIPOS_POR_CATEGORIA[cat];
                        const detalhe = detalhado === `${c.userId}:${cat}`;
                        return (
                          <div key={cat} className="rounded border px-2 py-2">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm">
                                {USER_NOTIF_CATEGORY_LABEL[cat]}
                              </span>
                              <div className="flex items-center gap-3">
                                {USER_NOTIF_CHANNELS.map((canal) => {
                                  const est = estadoCategoria(c.types, cat, canal);
                                  const podeCanal =
                                    canal === "whatsapp"
                                      ? c.hasPhone && temAgenteWhatsapp
                                      : c.hasEmail;
                                  return (
                                    <label
                                      key={canal}
                                      className={`flex items-center gap-1 text-xs ${
                                        podeCanal ? "cursor-pointer" : "opacity-50"
                                      }`}
                                    >
                                      <Checkbox
                                        checked={est === "todos"}
                                        className={
                                          est === "parcial"
                                            ? "ring-1 ring-muted-foreground"
                                            : undefined
                                        }
                                        disabled={!podeCanal || salvandoMatriz}
                                        onCheckedChange={(v) => {
                                          const ligar = v === true;
                                          void salvarMatriz(
                                            c.userId,
                                            Object.fromEntries(
                                              tipos.map((t) => [t, { [canal]: ligar }])
                                            )
                                          );
                                        }}
                                      />
                                      {canal === "email" ? "e-mail" : "WhatsApp"}
                                      {est === "parcial" && (
                                        <span className="text-muted-foreground">
                                          (alguns)
                                        </span>
                                      )}
                                    </label>
                                  );
                                })}
                                <button
                                  type="button"
                                  className="text-xs text-muted-foreground underline"
                                  onClick={() =>
                                    setDetalhado(
                                      detalhe ? null : `${c.userId}:${cat}`
                                    )
                                  }
                                >
                                  {detalhe ? "ocultar" : "detalhar"}
                                </button>
                              </div>
                            </div>

                            {detalhe && (
                              <div className="mt-2 space-y-1 border-t pt-2">
                                {tipos.map((t) => (
                                  <div
                                    key={t}
                                    className="flex items-center justify-between gap-3"
                                  >
                                    <span className="text-xs">
                                      {USER_CHANNEL_REGISTRY[t]?.label ?? t}
                                    </span>
                                    <div className="flex items-center gap-3">
                                      {USER_NOTIF_CHANNELS.map((canal) => {
                                        const podeCanal =
                                          canal === "whatsapp"
                                            ? c.hasPhone && temAgenteWhatsapp
                                            : c.hasEmail;
                                        return (
                                          <label
                                            key={canal}
                                            className={`flex items-center gap-1 text-xs ${
                                              podeCanal
                                                ? "cursor-pointer"
                                                : "opacity-50"
                                            }`}
                                          >
                                            <Checkbox
                                              checked={c.types[t]?.[canal] === true}
                                              disabled={!podeCanal || salvandoMatriz}
                                              onCheckedChange={(v) =>
                                                void salvarMatriz(c.userId, {
                                                  [t]: { [canal]: v === true },
                                                })
                                              }
                                            />
                                            {canal === "email"
                                              ? "e-mail"
                                              : "WhatsApp"}
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
