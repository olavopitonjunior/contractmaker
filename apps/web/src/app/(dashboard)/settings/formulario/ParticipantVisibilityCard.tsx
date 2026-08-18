"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { STEP_LABELS } from "@/lib/forms/validation";
import { LOCACAO_STEP_LABELS } from "@/lib/forms/validation-locacao";
import {
  DEFAULT_ROLE_STEPS,
  grantableSteps,
  parseParticipantVisibilityJson,
  ROLE_ESTEIRA,
  type FormEsteira,
  type ParticipantVisibilityConfig,
} from "@/lib/forms/participant-visibility";
import type { ParticipantRole } from "@/lib/forms/participant-token";

const ROLE_LABELS: Record<ParticipantRole, string> = {
  vendedor: "Vendedor",
  comprador: "Comprador",
  locador: "Proprietário (locador)",
  locatario: "Inquilino (locatário)",
  fiador: "Fiador",
};

const STEP_LABELS_BY_ESTEIRA: Record<FormEsteira, readonly string[]> = {
  venda: STEP_LABELS,
  locacao: LOCACAO_STEP_LABELS,
};

function rolesOf(esteira: FormEsteira): ParticipantRole[] {
  return (Object.keys(ROLE_ESTEIRA) as ParticipantRole[]).filter(
    (r) => ROLE_ESTEIRA[r] === esteira
  );
}

type Matrix = Record<string, number[]>;

function matrixFor(
  esteira: FormEsteira,
  config: ParticipantVisibilityConfig
): Matrix {
  const out: Matrix = {};
  for (const role of rolesOf(esteira)) {
    out[role] = [...(config[esteira]?.[role] ?? DEFAULT_ROLE_STEPS[role])];
  }
  return out;
}

/**
 * Matriz papel × etapa: o que cada link de parte enxerga no formulário
 * público. Etapa 0 (Documentos) é sempre incluída; a etapa de Comissão nunca
 * é oferecida (allowlist em lib/forms/participant-visibility.ts). Aplica ao
 * vivo em links já emitidos — visibilidade não é obrigatoriedade.
 */
export function ParticipantVisibilityCard({
  initial,
  locacaoEnabled,
}: {
  initial: unknown;
  locacaoEnabled: boolean;
}) {
  const config = parseParticipantVisibilityJson(initial);
  const [venda, setVenda] = useState<Matrix>(() => matrixFor("venda", config));
  const [locacao, setLocacao] = useState<Matrix>(() => matrixFor("locacao", config));
  const [saving, setSaving] = useState<FormEsteira | null>(null);

  const esteiras: FormEsteira[] = locacaoEnabled ? ["venda", "locacao"] : ["venda"];

  const toggle = (esteira: FormEsteira, role: string, step: number) => {
    const set = esteira === "venda" ? setVenda : setLocacao;
    set((prev) => {
      const cur = prev[role] ?? [];
      const next = cur.includes(step)
        ? cur.filter((s) => s !== step)
        : [...cur, step].sort((a, b) => a - b);
      return { ...prev, [role]: next.includes(0) ? next : [0, ...next] };
    });
  };

  const restore = (esteira: FormEsteira) => {
    const set = esteira === "venda" ? setVenda : setLocacao;
    set(() => matrixFor(esteira, {}));
  };

  const save = async (esteira: FormEsteira) => {
    setSaving(esteira);
    try {
      const matrix = esteira === "venda" ? venda : locacao;
      // Persiste SÓ os papéis que divergem do default de código. Papel igual ao
      // default fica fora do Json → segue o default VIVO (se o produto mudar o
      // default amanhã, a org acompanha). Gravar a matriz inteira congelaria o
      // default de hoje pra sempre; branch vazio = "tudo default" (o parse do
      // servidor descarta branch vazio, limpando a config da esteira).
      const diff: Matrix = {};
      for (const [role, steps] of Object.entries(matrix)) {
        const def = DEFAULT_ROLE_STEPS[role as ParticipantRole] ?? [];
        if (steps.length !== def.length || steps.some((s, i) => s !== def[i])) {
          diff[role] = steps;
        }
      }
      const res = await fetch("/api/org/form-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantVisibility: { [esteira]: diff } }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error ?? "Falha ao salvar visibilidade.");
        return;
      }
      toast.success(
        "Visibilidade salva — vale imediatamente, inclusive pra links já enviados."
      );
    } catch {
      toast.error("Erro ao salvar visibilidade.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Seções por link de parte</CardTitle>
        <CardDescription>
          Escolha quais etapas do formulário cada parte enxerga no próprio
          link. Documentos é sempre incluída; a etapa de Comissão é exclusiva
          do link principal. A mudança vale na hora, inclusive para links já
          enviados.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {esteiras.map((esteira) => {
          const matrix = esteira === "venda" ? venda : locacao;
          const labels = STEP_LABELS_BY_ESTEIRA[esteira];
          const steps = grantableSteps(esteira);
          return (
            <div key={esteira} className="space-y-2">
              <p className="text-sm font-semibold capitalize">
                {esteira === "venda" ? "Venda" : "Locação"}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-1.5 pr-3 font-medium">Link</th>
                      {steps.map((s) => (
                        <th key={s} className="py-1.5 px-2 font-medium whitespace-nowrap">
                          {labels[s] ?? `Etapa ${s}`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rolesOf(esteira).map((role) => (
                      <tr key={role} className="border-t border-border">
                        <td className="py-2 pr-3 font-medium whitespace-nowrap">
                          {ROLE_LABELS[role]}
                        </td>
                        {steps.map((s) => (
                          <td key={s} className="py-2 px-2">
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-primary"
                              checked={(matrix[role] ?? []).includes(s)}
                              disabled={s === 0}
                              title={s === 0 ? "Documentos é sempre incluída" : undefined}
                              onChange={() => toggle(esteira, role, s)}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => save(esteira)}
                  disabled={saving !== null}
                >
                  {saving === esteira ? "Salvando…" : "Salvar"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => restore(esteira)}
                  disabled={saving !== null}
                >
                  Restaurar padrão
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
