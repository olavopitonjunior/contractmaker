"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Settings2, Lock, Mail } from "lucide-react";
import { SaveStatusPill } from "@/components/settings/SaveStatusPill";
import { useSettingsAutoSave } from "@/hooks/use-settings-auto-save";
import {
  VENDA_FIELD_CATALOG,
  LOCACAO_FIELD_CATALOG,
  type FieldCatalogGroup,
} from "@/lib/forms/field-labels";
import {
  legacyPresetToModuleKey,
  type FormModule,
  type ModulePresetKey,
} from "@/lib/forms/presets";
import { useEsteira } from "./EsteiraTabs";

interface FormSettingsClientProps {
  initial: {
    preset: string;
    customRequiredPaths: unknown;
    locacaoPreset: string;
    locacaoCustomRequiredPaths: unknown;
    autoLockFormOnFinalize: boolean;
    requireCommissionerReceiving: boolean;
    summaryRecipientEmail?: string | null;
    autoSendSummaryOnComplete?: boolean;
    summaryIncludeAttachments?: boolean;
  };
}

interface CustomPathItem {
  step: number;
  path: string;
}

const ENDPOINT = "/api/org/form-settings";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type StepCatalog = ReadonlyArray<FieldCatalogGroup>;

// Catálogo e rótulos vivem em lib/forms/field-labels.ts: os wizards precisam do
// MESMO vocabulário pra nomear as pendências no toast, e mantê-lo aqui dentro
// deixava o formulário público sem acesso a ele.
const VENDA_CATALOG: StepCatalog = VENDA_FIELD_CATALOG;
const LOCACAO_CATALOG: StepCatalog = LOCACAO_FIELD_CATALOG;

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

export function FormSettingsClient({ initial }: FormSettingsClientProps) {
  // A esteira é da PÁGINA, não deste card: o mesmo seletor governa o padrão
  // contratual e o catálogo de seguradoras (ver EsteiraTabs.tsx).
  // `esteira`, não `module`: o nome `module` colide com a variável global do
  // CommonJS e o `@next/next/no-assign-module-variable` reprova a atribuição.
  const esteira = useEsteira();

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
  const [requireReceiving, setRequireReceiving] = useState(
    Boolean(initial.requireCommissionerReceiving)
  );
  const [summaryEmail, setSummaryEmail] = useState(initial.summaryRecipientEmail ?? "");
  const [autoSend, setAutoSend] = useState(initial.autoSendSummaryOnComplete ?? false);
  const [includeAttachments, setIncludeAttachments] = useState(
    initial.summaryIncludeAttachments ?? true,
  );

  // Três seções independentes de auto-save, uma por card. Independentes de
  // propósito: o save único que existia aqui mandava TUDO no mesmo corpo, e um
  // path customizado órfão (campo renomeado) fazia a rota reprovar o PATCH
  // inteiro — os toggles de segurança falhavam junto, sob um toast genérico.
  const campos = useSettingsAutoSave(
    {
      preset: vendaPreset,
      customRequiredPaths: vendaPaths,
      locacaoPreset,
      locacaoCustomRequiredPaths: locacaoPaths,
    },
    { endpoint: ENDPOINT },
  );

  const seguranca = useSettingsAutoSave(
    {
      autoLockFormOnFinalize: autoLock,
      requireCommissionerReceiving: requireReceiving,
    },
    { endpoint: ENDPOINT },
  );

  const trimmedEmail = summaryEmail.trim();
  const emailValido = trimmedEmail === "" || EMAIL_RE.test(trimmedEmail);
  const resumo = useSettingsAutoSave(
    {
      summaryRecipientEmail: trimmedEmail,
      autoSendSummaryOnComplete: autoSend,
      summaryIncludeAttachments: includeAttachments,
    },
    {
      endpoint: ENDPOINT,
      // E-mail pela metade não pode ir pra rota: o Zod devolveria 400 e a pill
      // travaria em erro no meio da digitação. Mas quem fica retido é SÓ ele —
      // com um `isValid` de seção, o e-mail incompleto segurava junto os dois
      // toggles vizinhos, que não têm relação nenhuma com ele e já estavam
      // prontos para gravar. Sair da página perdia o toggle, calado.
      invalidKeys: (f) => {
        const v = String(f.summaryRecipientEmail ?? "");
        return v === "" || EMAIL_RE.test(v) ? [] : ["summaryRecipientEmail"];
      },
    },
  );

  const isVenda = esteira === "venda";
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">
              Campos obrigatórios · {MODULE_LABEL[esteira]}
            </CardTitle>
            <SaveStatusPill status={campos.status} isDirty={campos.isDirty} />
          </div>
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

          {PRESET_CARDS[esteira].map((card) => (
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
                name={`preset-${esteira}`}
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
            Campos adicionais — {MODULE_LABEL[esteira]}
          </CardTitle>
          <div className="flex items-center gap-3">
            {/* Mesma seção de salvamento do card acima: os dois editam o par
                preset + paths customizados, então compartilham o estado. */}
            <SaveStatusPill status={campos.status} isDirty={campos.isDirty} />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowOverride((v) => !v)}
            >
              {showOverride ? "Ocultar" : "Personalizar"}
            </Button>
          </div>
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
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Lock className="h-4 w-4" />
              Segurança do link
            </CardTitle>
            <SaveStatusPill
              status={seguranca.status}
              isDirty={seguranca.isDirty}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
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

          <label className="flex items-start justify-between gap-4 cursor-pointer">
            <div className="flex-1">
              <p className="text-sm font-medium">
                Exigir os dados bancários do corretor
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Na etapa Comissão, cada corretor precisa informar a chave PIX{" "}
                <strong>ou</strong> os dados da conta bancária (banco, agência,
                conta e tipo) antes de concluir. Vale para venda e locação. Só se
                aplica a quem preenche logado como membro da imobiliária: o
                cliente que recebe o link não vê esses campos.
              </p>
            </div>
            <Switch
              checked={requireReceiving}
              onCheckedChange={setRequireReceiving}
            />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Resumo do formulário por e-mail
            </CardTitle>
            <SaveStatusPill status={resumo.status} isDirty={resumo.isDirty} />
          </div>
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
              onBlur={() => void resumo.flush()}
              aria-invalid={!emailValido}
              aria-describedby={!emailValido ? "summary-email-erro" : undefined}
            />
            {!emailValido && (
              <p id="summary-email-erro" className="text-xs text-destructive">
                E-mail inválido — ainda não foi salvo.
              </p>
            )}
            {emailValido && trimmedEmail === "" && autoSend && (
              <p className="text-xs text-amber-700 dark:text-amber-500">
                O envio automático está ligado, mas sem destinatário nada é
                enviado.
              </p>
            )}
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

    </div>
  );
}
