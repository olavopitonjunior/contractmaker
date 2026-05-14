"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Loader2, Settings2 } from "lucide-react";

type Preset = "legado" | "minimo" | "padrao" | "completo" | "custom";

interface FormSettingsClientProps {
  initial: {
    preset: string;
    customRequiredPaths: unknown;
  };
}

interface CustomPathItem {
  step: number;
  path: string;
}

// Catálogo dos paths editáveis no override fino. Não é exaustivo — só os
// campos onde faz sentido permitir override de obrigatoriedade por org. Paths
// fora desta lista podem ser adicionados manualmente via API se necessário.
const STEP_PATH_CATALOG: ReadonlyArray<{
  step: number;
  label: string;
  paths: ReadonlyArray<{ path: string; label: string }>;
}> = [
  {
    step: 1,
    label: "Vendedor",
    paths: [
      { path: "vendedores.0.cpf", label: "CPF" },
      { path: "vendedores.0.rg", label: "RG" },
      { path: "vendedores.0.data_nascimento", label: "Data de nascimento" },
      { path: "vendedores.0.nome_mae", label: "Nome da mãe (TJSP/PGFN)" },
      { path: "vendedores.0.estado_civil", label: "Estado civil" },
      { path: "vendedores.0.profissao", label: "Profissão" },
      { path: "vendedores.0.email", label: "Email" },
      { path: "vendedores.0.mobile_phone", label: "Celular" },
      { path: "vendedores.0.endereco", label: "Endereço (rua)" },
      { path: "vendedores.0.cidade", label: "Cidade" },
      { path: "vendedores.0.uf", label: "UF" },
      { path: "vendedores.0.cep", label: "CEP" },
    ],
  },
  {
    step: 2,
    label: "Comprador",
    paths: [
      { path: "compradores.0.cpf", label: "CPF" },
      { path: "compradores.0.rg", label: "RG" },
      { path: "compradores.0.data_nascimento", label: "Data de nascimento" },
      { path: "compradores.0.nome_mae", label: "Nome da mãe (TJSP/PGFN)" },
      { path: "compradores.0.estado_civil", label: "Estado civil" },
      { path: "compradores.0.profissao", label: "Profissão" },
      { path: "compradores.0.email", label: "Email" },
      { path: "compradores.0.mobile_phone", label: "Celular" },
      { path: "compradores.0.endereco", label: "Endereço (rua)" },
      { path: "compradores.0.cidade", label: "Cidade" },
      { path: "compradores.0.uf", label: "UF" },
      { path: "compradores.0.cep", label: "CEP" },
    ],
  },
  {
    step: 3,
    label: "Imóvel",
    paths: [
      { path: "imoveis.0.numero", label: "Número" },
      { path: "imoveis.0.bairro", label: "Bairro" },
      { path: "imoveis.0.cep", label: "CEP" },
      { path: "imoveis.0.matricula", label: "Matrícula" },
      { path: "imoveis.0.cartorio", label: "Cartório" },
      { path: "imoveis.0.inscricao_iptu", label: "Inscrição IPTU" },
      { path: "imoveis.0.sql", label: "SQL (Setor.Quadra.Lote)" },
    ],
  },
  {
    step: 5,
    label: "Pagamento",
    paths: [
      { path: "modalidade", label: "Modalidade (à vista / financiamento)" },
      { path: "pagamento.sinal_arras", label: "Sinal/Arras" },
    ],
  },
];

const PRESET_DESCRIPTIONS: Record<Preset, { title: string; subtitle: string }> = {
  legado: {
    title: "Legado",
    subtitle:
      "Comportamento padrão antes desta config — só nome+identificador das partes, valor total e descrição do imóvel.",
  },
  minimo: {
    title: "Mínimo",
    subtitle: "Igual ao Legado, mas com descrição do imóvel resumida.",
  },
  padrao: {
    title: "Padrão",
    subtitle:
      "+ Endereço completo das partes, estado civil e identificação fiscal. Recomendado para a maioria dos negócios.",
  },
  completo: {
    title: "Completo",
    subtitle:
      "+ RG, data de nascimento, nome da mãe e endereço do imóvel. Necessário para certidões TJSP/PGFN/Antecedentes PF.",
  },
  custom: {
    title: "Personalizado",
    subtitle:
      "Usa apenas a sua seleção fina abaixo, sem base de preset. Use com cuidado — você pode acabar exigindo menos que o mínimo legal.",
  },
};

function parseCustomPaths(raw: unknown): CustomPathItem[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomPathItem[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === "object" &&
      "step" in item &&
      "path" in item &&
      typeof (item as { step: unknown }).step === "number" &&
      typeof (item as { path: unknown }).path === "string"
    ) {
      out.push({
        step: (item as { step: number }).step,
        path: (item as { path: string }).path,
      });
    }
  }
  return out;
}

export function FormSettingsClient({ initial }: FormSettingsClientProps) {
  const [preset, setPreset] = useState<Preset>(initial.preset as Preset);
  const [customPaths, setCustomPaths] = useState<CustomPathItem[]>(() =>
    parseCustomPaths(initial.customRequiredPaths),
  );
  const [showOverride, setShowOverride] = useState(
    parseCustomPaths(initial.customRequiredPaths).length > 0,
  );
  const [saving, setSaving] = useState(false);

  const selected = useMemo(() => {
    const set = new Set<string>();
    for (const p of customPaths) set.add(`${p.step}::${p.path}`);
    return set;
  }, [customPaths]);

  function togglePath(step: number, path: string) {
    const key = `${step}::${path}`;
    setCustomPaths((prev) => {
      if (prev.some((p) => p.step === step && p.path === path)) {
        return prev.filter((p) => !(p.step === step && p.path === path));
      }
      return [...prev, { step, path }];
    });
    void key;
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/org/form-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          preset,
          customRequiredPaths: customPaths,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error ?? "Falha ao salvar configurações");
        return;
      }
      toast.success("Configurações salvas");
    } catch {
      toast.error("Erro de rede ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preset de obrigatoriedade</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(["legado", "minimo", "padrao", "completo", "custom"] as Preset[]).map(
            (p) => {
              const desc = PRESET_DESCRIPTIONS[p];
              return (
                <label
                  key={p}
                  className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                    preset === p
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/30"
                  }`}
                >
                  <input
                    type="radio"
                    name="preset"
                    value={p}
                    checked={preset === p}
                    onChange={() => setPreset(p)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{desc.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {desc.subtitle}
                    </p>
                  </div>
                </label>
              );
            },
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Override fino (adiciona ao preset)
          </CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowOverride((v) => !v)}
          >
            {showOverride ? "Ocultar" : "Personalizar"}
          </Button>
        </CardHeader>
        {showOverride && (
          <CardContent className="space-y-5">
            <p className="text-xs text-muted-foreground">
              Campos marcados aqui ficam obrigatórios EM ADIÇÃO ao preset. Se
              você escolheu "Personalizado" acima, somente os campos aqui são
              exigidos. A regra "cônjuge obrigatório se casado" é aplicada
              automaticamente — não precisa marcar.
            </p>
            {STEP_PATH_CATALOG.map((stepGroup) => (
              <div key={stepGroup.step} className="space-y-2">
                <Label className="text-sm font-medium">
                  Etapa {stepGroup.step + 1} — {stepGroup.label}
                </Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pl-1">
                  {stepGroup.paths.map((p) => {
                    const key = `${stepGroup.step}::${p.path}`;
                    const checked = selected.has(key);
                    return (
                      <label
                        key={p.path}
                        className="flex items-center gap-2 text-sm cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePath(stepGroup.step, p.path)}
                        />
                        <span>{p.label}</span>
                        <code className="text-[10px] text-muted-foreground">
                          {p.path}
                        </code>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </CardContent>
        )}
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              Salvando...
            </>
          ) : (
            "Salvar"
          )}
        </Button>
      </div>
    </div>
  );
}
