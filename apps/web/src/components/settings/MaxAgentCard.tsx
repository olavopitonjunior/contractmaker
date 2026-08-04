"use client";

import { useState } from "react";
import { toast } from "sonner";
import { MessageCircle, Check, AlertTriangle, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Ativação do Max pelo dono da imobiliária.
 *
 * Existe porque ligar o Max era exclusividade de `super_admin` no painel de
 * plataforma — o dono não tinha superfície nenhuma, o que destoa de todo o
 * resto de `/settings/*`, onde a imobiliária se configura sozinha.
 *
 * O card mostra os DOIS lados do estado, e o segundo é o que costuma faltar:
 * o agente estar provisionado não significa que alguém receba. Quem recebe é
 * quem tem telefone no perfil E optou por WhatsApp — opt-in pessoal, que a
 * imobiliária não pode dar por ninguém. Sem exibir esse placar, o tenant fica
 * com a feature verde e o agente mudo, que foi exatamente o estado dos quatro
 * primeiros.
 */
export interface MaxAgentState {
  /** O super_admin liberou o canal para esta org. */
  available: boolean;
  /** Provisionado E com entrega confirmada ao serviço. */
  active: boolean;
  /** Motivo da última falha, quando houver. */
  lastError: string | null;
  membersWithPhone: number;
  membersTotal: number;
  optedIn: number;
}

export function MaxAgentCard({
  state,
  canEdit,
}: {
  state: MaxAgentState;
  canEdit: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(state.active);

  if (!state.available) return null;

  async function ativar() {
    setBusy(true);
    try {
      const res = await fetch("/api/org/max/activate", {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(body.reason ?? "Não foi possível ativar o Max.");
        return;
      }
      if (!body.delivered) {
        // Estado real e recuperável: o acesso existe, faltou a entrega ao
        // serviço. O cron reconcilia sozinho — dizer "deu erro" faria o dono
        // clicar de novo, e cada clique rotaciona o token.
        toast.warning(
          "Acesso criado, mas o serviço do Max não confirmou. Vamos tentar de novo automaticamente."
        );
        return;
      }
      setActive(true);
      toast.success("Max ativado para a sua imobiliária.");
    } finally {
      setBusy(false);
    }
  }

  const semTelefone = state.membersTotal - state.membersWithPhone;

  return (
    <Card id="max">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <MessageCircle className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-medium">Max — assistente no WhatsApp</h3>
                {active ? (
                  <span className="rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-800">
                    ativo
                  </span>
                ) : (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    não ativado
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Avisa sua equipe quando um contrato é assinado, uma comissão é
                paga ou um formulário trava — e responde dúvidas sobre o
                processo.
              </p>
            </div>
          </div>
          {!active && canEdit && (
            <Button onClick={ativar} disabled={busy} size="sm">
              {busy ? "Ativando…" : "Ativar o Max"}
            </Button>
          )}
        </div>

        {state.lastError && !active && (
          <p className="flex items-start gap-2 text-xs text-amber-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{state.lastError}</span>
          </p>
        )}

        {/* O placar que importa. Fica visível mesmo com o Max ativo: é a
            diferença entre "ligado" e "alcançando alguém". */}
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <Phone className="h-4 w-4" />
            Quem recebe hoje
          </div>
          {state.optedIn > 0 ? (
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <Check className="h-4 w-4 text-green-600" />
              {state.optedIn} de {state.membersTotal}{" "}
              {state.membersTotal === 1 ? "pessoa recebe" : "pessoas recebem"}{" "}
              avisos no WhatsApp.
            </p>
          ) : (
            <p className="text-muted-foreground">
              Ninguém ainda. O Max reconhece cada pessoa pelo telefone do
              cadastro — sem isso, ele não avisa e não responde.
            </p>
          )}
          {semTelefone > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {semTelefone}{" "}
              {semTelefone === 1
                ? "pessoa está sem telefone"
                : "pessoas estão sem telefone"}{" "}
              no perfil.
            </p>
          )}
          {/* Cada pessoa liga o próprio WhatsApp: o número é dado pessoal, e a
              imobiliária pode desligar mas nunca ligar por alguém. */}
          <p className="mt-2 text-xs text-muted-foreground">
            Cada pessoa ativa os avisos no próprio perfil, em{" "}
            <a href="/settings/profile" className="underline">
              Meu perfil
            </a>
            .
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
