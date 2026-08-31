"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SaveStatusPill } from "@/components/settings/SaveStatusPill";
import { useSettingsAutoSave } from "@/hooks/use-settings-auto-save";
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

/**
 * Persiste SÓ os papéis que divergem do default de código. Papel igual ao
 * default fica fora do Json → segue o default VIVO (se o produto mudar o
 * default amanhã, a org acompanha). Gravar a matriz inteira congelaria o
 * default de hoje pra sempre; branch vazio = "tudo default" (o parse do
 * servidor descarta branch vazio, limpando a config da esteira).
 */
function diffOf(matrix: Matrix): Matrix {
  const diff: Matrix = {};
  for (const [role, steps] of Object.entries(matrix)) {
    const def = DEFAULT_ROLE_STEPS[role as ParticipantRole] ?? [];
    if (steps.length !== def.length || steps.some((s, i) => s !== def[i])) {
      diff[role] = steps;
    }
  }
  return diff;
}

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

  const esteiras: FormEsteira[] = locacaoEnabled ? ["venda", "locacao"] : ["venda"];

  // UM auto-save para as duas esteiras, não um por tabela.
  //
  // Este card mostra Venda e Locação simultaneamente (não há aba aqui), então
  // dois hooks independentes deixariam dois PATCHes concorrentes voando contra
  // a MESMA coluna `participantVisibilityJson`. O merge no servidor é
  // leitura-e-escrita sem transação: se o segundo request lesse a linha antes
  // de o primeiro gravar, ele sobrescreveria o branch recém-salvo do outro —
  // marcar um checkbox em cada tabela bastava para perder um dos dois.
  // Com um payload só, as duas esteiras viajam juntas e não há corrida.
  const autoSave = useSettingsAutoSave(
    useMemo(
      () => ({
        participantVisibility: locacaoEnabled
          ? { venda: diffOf(venda), locacao: diffOf(locacao) }
          : // Sem o módulo, a tabela de locação nem é renderizada: mandar o
            // branch dela seria gravar um estado que o usuário não editou.
            { venda: diffOf(venda) },
      }),
      [venda, locacao, locacaoEnabled],
    ),
    { endpoint: "/api/org/form-settings" },
  );

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
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => restore(esteira)}
                  disabled={autoSave.status === "saving"}
                >
                  Restaurar padrão
                </Button>
                <SaveStatusPill
                  status={autoSave.status}
                  isDirty={autoSave.isDirty}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
