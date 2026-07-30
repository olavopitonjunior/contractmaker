"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Loader2, Settings2, Lock, Mail } from "lucide-react";
import {
  legacyPresetToModuleKey,
  type FormModule,
  type ModulePresetKey,
} from "@/lib/forms/presets";

interface FormSettingsClientProps {
  initial: {
    preset: string;
    customRequiredPaths: unknown;
    locacaoPreset: string;
    locacaoCustomRequiredPaths: unknown;
    autoLockFormOnFinalize: boolean;
    summaryRecipientEmail?: string | null;
    autoSendSummaryOnComplete?: boolean;
    summaryIncludeAttachments?: boolean;
  };
  /** Módulo de locação habilitado pro tenant (lib/modules). */
  locacaoEnabled: boolean;
}

interface CustomPathItem {
  step: number;
  path: string;
}

type StepCatalog = ReadonlyArray<{
  step: number;
  label: string;
  paths: ReadonlyArray<{ path: string; label: string }>;
}>;

// Catálogo dos paths editáveis no override fino. Não é exaustivo — só os
// campos onde faz sentido permitir override de obrigatoriedade por org. Paths
// fora desta lista podem ser adicionados manualmente via API se necessário.
const VENDA_CATALOG: StepCatalog = [
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

// Steps do wizard de locação (LOCACAO_STEP_LABELS). Garantia fica de fora: o
// fiador só existe quando a garantia é fiança, e a exigência dele já é
// condicional no servidor (collectLocacaoFinalizeIssues).
const LOCACAO_CATALOG: StepCatalog = [
  {
    step: 1,
    label: "Locador",
    paths: [
      { path: "locadores.0.cpf", label: "CPF / CNPJ" },
      { path: "locadores.0.rg", label: "RG" },
      { path: "locadores.0.data_nascimento", label: "Data de nascimento" },
      { path: "locadores.0.nacionalidade", label: "Nacionalidade" },
      { path: "locadores.0.estado_civil", label: "Estado civil" },
      { path: "locadores.0.profissao", label: "Profissão" },
      { path: "locadores.0.email", label: "E-mail" },
      { path: "locadores.0.mobile_phone", label: "Celular" },
      { path: "locadores.0.endereco", label: "Endereço (rua)" },
      { path: "locadores.0.numero", label: "Número" },
      { path: "locadores.0.bairro", label: "Bairro" },
      { path: "locadores.0.cidade", label: "Cidade" },
      { path: "locadores.0.uf", label: "UF" },
      { path: "locadores.0.cep", label: "CEP" },
    ],
  },
  {
    step: 2,
    label: "Locatário",
    paths: [
      { path: "locatarios.0.cpf", label: "CPF / CNPJ" },
      { path: "locatarios.0.rg", label: "RG" },
      { path: "locatarios.0.data_nascimento", label: "Data de nascimento" },
      { path: "locatarios.0.nacionalidade", label: "Nacionalidade" },
      { path: "locatarios.0.estado_civil", label: "Estado civil" },
      { path: "locatarios.0.profissao", label: "Profissão" },
      { path: "locatarios.0.email", label: "E-mail" },
      { path: "locatarios.0.mobile_phone", label: "Celular" },
      { path: "locatarios.0.endereco", label: "Endereço (rua)" },
      { path: "locatarios.0.numero", label: "Número" },
      { path: "locatarios.0.bairro", label: "Bairro" },
      { path: "locatarios.0.cidade", label: "Cidade" },
      { path: "locatarios.0.uf", label: "UF" },
      { path: "locatarios.0.cep", label: "CEP" },
    ],
  },
  {
    step: 3,
    label: "Imóvel",
    paths: [
      { path: "imovel.numero", label: "Número" },
      { path: "imovel.bairro", label: "Bairro" },
      { path: "imovel.cep", label: "CEP" },
      { path: "imovel.matricula", label: "Matrícula" },
      { path: "imovel.cartorio", label: "Cartório" },
      { path: "imovel.inscricao_iptu", label: "Inscrição IPTU" },
    ],
  },
  {
    step: 4,
    label: "Aluguel e Reajuste",
    paths: [
      { path: "aluguel.vigencia_inicio", label: "Início da vigência" },
      { path: "aluguel.dia_vencimento", label: "Dia de vencimento" },
      { path: "aluguel.indice_reajuste", label: "Índice de reajuste" },
    ],
  },
];

const MODULE_LABEL: Record<FormModule, string> = {
  venda: "Vendas",
  locacao: "Locação",
};

const PRESET_CARDS: Record<
  FormModule,
  ReadonlyArray<{ key: "essencial" | "completo"; title: string; subtitle: string }>
> = {
  venda: [
    {
      key: "essencial",
      title: "Essencial",
      subtitle:
        "O mínimo pra gerar o contrato e mandar assinar: nome, CPF/CNPJ, e-mail, celular e endereço básico das partes, endereço e descrição do imóvel, valor total.",
    },
    {
      key: "completo",
      title: "Completo",
      subtitle:
        "Tudo que os modelos e as certidões usam: + RG, data de nascimento, nome da mãe, sexo, estado civil, profissão, CEP e matrícula do imóvel. Necessário para TJSP/PGFN/Antecedentes PF.",
    },
  ],
  locacao: [
    {
      key: "essencial",
      title: "Essencial",
      subtitle:
        "O mínimo pra gerar o contrato e mandar assinar: nome, CPF/CNPJ, e-mail, celular e endereço básico de locadores e locatários, endereço e descrição do imóvel, valor e início da vigência.",
    },
    {
      key: "completo",
      title: "Completo",
      subtitle:
        "Tudo que os modelos de locação usam na qualificação: + RG, data de nascimento, nacionalidade, estado civil, profissão, endereço completo das partes, CEP e matrícula do imóvel.",
    },
  ],
};

// Valores antigos de venda (pré-2026-07-28). Continuam valendo no banco e
// resolvem os MESMOS campos de sempre — a conversão pro modelo novo só
// acontece quando o admin salva esta tela.
const LEGACY_VENDA_LABELS: Record<string, string> = {
  legado: "Legado",
  minimo: "Mínimo",
  padrao: "Padrão",
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

export function FormSettingsClient({
  initial,
  locacaoEnabled,
}: FormSettingsClientProps) {
  const [module, setModule] = useState<FormModule>("venda");

  // Estado por módulo. `preset` guarda o valor CRU (pode ser um dos legados de
  // venda enquanto ninguém salvar) — o card marcado sai de
  // legacyPresetToModuleKey.
  const [vendaPreset, setVendaPreset] = useState<string>(initial.preset);
  const [vendaPaths, setVendaPaths] = useState<CustomPathItem[]>(() =>
    parseCustomPaths(initial.customRequiredPaths),
  );
  const [locacaoPreset, setLocacaoPreset] = useState<string>(
    initial.locacaoPreset,
  );
  const [locacaoPaths, setLocacaoPaths] = useState<CustomPathItem[]>(() =>
    parseCustomPaths(initial.locacaoCustomRequiredPaths),
  );

  const [showOverride, setShowOverride] = useState(
    parseCustomPaths(initial.customRequiredPaths).length > 0 ||
      parseCustomPaths(initial.locacaoCustomRequiredPaths).length > 0,
  );
  const [autoLock, setAutoLock] = useState(Boolean(initial.autoLockFormOnFinalize));
  const [summaryEmail, setSummaryEmail] = useState(initial.summaryRecipientEmail ?? "");
  const [autoSend, setAutoSend] = useState(initial.autoSendSummaryOnComplete ?? false);
  const [includeAttachments, setIncludeAttachments] = useState(
    initial.summaryIncludeAttachments ?? true,
  );
  const [saving, setSaving] = useState(false);

  const isVenda = module === "venda";
  const preset = isVenda ? vendaPreset : locacaoPreset;
  const setPreset = isVenda ? setVendaPreset : setLocacaoPreset;
  const customPaths = isVenda ? vendaPaths : locacaoPaths;
  const setCustomPaths = isVenda ? setVendaPaths : setLocacaoPaths;
  const catalog = isVenda ? VENDA_CATALOG : LOCACAO_CATALOG;

  const isCustomOnly = preset === "custom";
  // Nenhum card marcado quando o valor salvo não é canônico:
  //  - locação em "legado" = nada obrigatório (comportamento histórico);
  //  - venda em legado/minimo/padrao = configuração antiga que continua
  //    valendo como está.
  // Em ambos os casos, mudar de nível é uma escolha EXPLÍCITA do admin — o
  // salvamento não converte nada sozinho (senão a exigência do formulário
  // mudaria só porque alguém abriu a tela pra mexer no e-mail do resumo).
  const selectedCard: ModulePresetKey | null = isCustomOnly
    ? null
    : preset === "essencial" || preset === "completo"
      ? preset
      : null;
  const legacyVendaLabel = isVenda ? LEGACY_VENDA_LABELS[preset] : undefined;
  const legacyEquivalent = legacyVendaLabel
    ? legacyPresetToModuleKey(preset) === "completo"
      ? "Completo"
      : "Essencial"
    : null;

  const selected = useMemo(() => {
    const set = new Set<string>();
    for (const p of customPaths) set.add(`${p.step}::${p.path}`);
    return set;
  }, [customPaths]);

  function togglePath(step: number, path: string) {
    setCustomPaths((prev) => {
      if (prev.some((p) => p.step === step && p.path === path)) {
        return prev.filter((p) => !(p.step === step && p.path === path));
      }
      return [...prev, { step, path }];
    });
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/org/form-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          preset: vendaPreset,
          customRequiredPaths: vendaPaths,
          // Os dois módulos vão sempre no mesmo PATCH, cada um com o valor que
          // está na tela — inclusive "legado"/valores antigos, que o servidor
          // aceita e que significam "não mexer no comportamento atual".
          locacaoPreset,
          locacaoCustomRequiredPaths: locacaoPaths,
          autoLockFormOnFinalize: autoLock,
          summaryRecipientEmail: summaryEmail.trim(),
          autoSendSummaryOnComplete: autoSend,
          summaryIncludeAttachments: includeAttachments,
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
        <CardHeader className="space-y-3">
          <CardTitle className="text-base">Campos obrigatórios</CardTitle>
          {locacaoEnabled && (
            <div className="inline-flex rounded-lg border p-0.5 w-fit">
              {(["venda", "locacao"] as FormModule[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModule(m)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    module === m
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {MODULE_LABEL[m]}
                </button>
              ))}
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {!isVenda && selectedCard === null && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              O formulário de locação ainda não exige nada além do mínimo (nome
              das partes, descrição do imóvel e valor do aluguel). Escolha um
              nível abaixo para passar a exigir os demais campos.
            </p>
          )}
          {legacyVendaLabel && (
            <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
              Sua configuração atual é <strong>{legacyVendaLabel}</strong>, do
              modelo antigo, e continua valendo exatamente como está — nada muda
              sozinho. Ela equivale a <strong>{legacyEquivalent}</strong> no
              modelo novo; escolha um nível abaixo se quiser migrar.
            </p>
          )}

          {PRESET_CARDS[module].map((card) => (
            <label
              key={card.key}
              className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                selectedCard === card.key
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/30"
              }`}
            >
              <input
                type="radio"
                name={`preset-${module}`}
                value={card.key}
                checked={selectedCard === card.key}
                onChange={() => setPreset(card.key)}
                className="mt-1"
              />
              <div className="flex-1">
                <p className="text-sm font-medium">{card.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {card.subtitle}
                </p>
              </div>
            </label>
          ))}

          <label className="flex items-start gap-3 rounded-lg border border-dashed p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isCustomOnly}
              onChange={(e) => {
                setPreset(e.target.checked ? "custom" : "essencial");
                if (e.target.checked) setShowOverride(true);
              }}
              className="mt-1"
            />
            <div className="flex-1">
              <p className="text-sm font-medium">
                Exigir somente os campos que eu marcar
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Ignora o nível acima e usa apenas a seleção fina abaixo. Use com
                cuidado — dá pra acabar exigindo menos que o mínimo pra assinar.
              </p>
            </div>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Campos adicionais — {MODULE_LABEL[module]}
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
              Campos marcados aqui ficam obrigatórios EM ADIÇÃO ao nível
              escolhido (ou como única exigência, se você marcou &ldquo;somente
              os campos que eu marcar&rdquo;). A regra &ldquo;cônjuge
              obrigatório se casado&rdquo; é aplicada automaticamente — não
              precisa marcar.
            </p>
            {catalog.map((stepGroup) => (
              <div key={stepGroup.step} className="space-y-2">
                <Label className="text-sm font-medium">
                  Etapa {stepGroup.step + 1} — {stepGroup.label}
                </Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pl-1">
                  {stepGroup.paths.map((p) => {
                    const key = `${stepGroup.step}::${p.path}`;
                    return (
                      <label
                        key={p.path}
                        className="flex items-center gap-2 text-sm cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(key)}
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Lock className="h-4 w-4" />
            Segurança do link
          </CardTitle>
        </CardHeader>
        <CardContent>
          <label className="flex items-start justify-between gap-4 cursor-pointer">
            <div className="flex-1">
              <p className="text-sm font-medium">
                Travar o formulário quando o cliente finalizar
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Ao finalizar, o formulário é congelado automaticamente: quem tiver
                o link ainda consegue consultar, mas não editar. Evita alterações
                indevidas após o negócio estar fechado. Você sempre pode destravar
                manualmente no negócio.
              </p>
            </div>
            <Switch checked={autoLock} onCheckedChange={setAutoLock} />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Resumo do formulário por e-mail
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Gera um PDF consolidado com tudo o que foi preenchido e pode
            encaminhá-lo (com os documentos anexados) por e-mail. O envio manual
            está disponível no detalhe de cada negócio.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="summary-email">E-mail destinatário (automação)</Label>
            <Input
              id="summary-email"
              type="email"
              placeholder="juridico@suaimobiliaria.com"
              value={summaryEmail}
              onChange={(e) => setSummaryEmail(e.target.value)}
            />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Enviar automaticamente ao finalizar</p>
              <p className="text-xs text-muted-foreground">
                Ao concluir um formulário, envia o resumo para o e-mail acima.
              </p>
            </div>
            <Switch checked={autoSend} onCheckedChange={setAutoSend} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Incluir documentos anexados</p>
              <p className="text-xs text-muted-foreground">
                Anexa também os arquivos enviados no formulário (respeitando o
                limite de tamanho do e-mail).
              </p>
            </div>
            <Switch checked={includeAttachments} onCheckedChange={setIncludeAttachments} />
          </label>
        </CardContent>
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
