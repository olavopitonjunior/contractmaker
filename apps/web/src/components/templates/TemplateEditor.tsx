"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ADMINISTRACAO_LOCACAO_MODALIDADE,
  TEMPLATE_CATEGORIES,
  CATEGORY_LABELS,
  CATEGORY_TO_GROUP,
  GARANTIA_TIPOS,
  GARANTIA_LABELS,
  GROUP_LABELS,
  LOCACAO_MODALIDADES,
  modalidadeForCategory,
  modalidadeLabel,
  parseMatchCriteria,
  templateFamilyForModalidade,
  type TemplateCategory,
  type TemplateFamily,
  type TemplateMatchCriteria,
} from "@/lib/contracts/template-category";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Save, Trash2, ArrowLeft, Eye } from "lucide-react";
import Link from "next/link";
import { TemplatePreview } from "./TemplatePreview";

const PROPOSTA_MODALIDADES: { value: string; label: string }[] = [
  { value: "proposta_venda", label: "Proposta de Compra (venda)" },
  { value: "proposta_locacao_residencial", label: "Proposta de Locação Residencial" },
  { value: "proposta_locacao_comercial", label: "Proposta de Locação Comercial" },
];

interface TemplateEditorProps {
  template?: {
    id: string;
    name: string;
    description: string;
    handlebarsSource: string;
    modalidade: string | null;
    category?: string | null;
    matchCriteria?: unknown;
    isDefault: boolean;
    version: string;
    status: string;
    engine?: string;
    googleTemplateDocId?: string | null;
  };
  mode: "create" | "edit";
}

export function TemplateEditor({ template, mode }: TemplateEditorProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [name, setName] = useState(template?.name || "");
  const [description, setDescription] = useState(template?.description || "");
  const [handlebarsSource, setHandlebarsSource] = useState(template?.handlebarsSource || "");
  // Categoria é canônica. Fallback p/ templates legados sem category: deriva do
  // modalidade (financiamento → financiamento; resto → compra_e_venda).
  const initialCategory: TemplateCategory =
    (TEMPLATE_CATEGORIES as readonly string[]).includes(template?.category ?? "")
      ? (template!.category as TemplateCategory)
      : template?.modalidade === "financiamento"
        ? "financiamento"
        : "compra_e_venda";
  const [category, setCategory] = useState<TemplateCategory>(initialCategory);
  const [isDefault, setIsDefault] = useState(template?.isDefault || false);
  const [version, setVersion] = useState(template?.version || "1.0.0");

  // Família do documento: contrato de venda (categoria = forma de pagamento),
  // contrato de locação (modalidade própria) ou proposta (modalidade
  // proposta_*). A família vem da MODALIDADE persistida — a categoria só
  // descreve pagamento e não existe fora de venda.
  const initialFamily = templateFamilyForModalidade(template?.modalidade);
  const [family, setFamily] = useState<TemplateFamily>(
    mode === "create" ? "venda" : initialFamily
  );
  const [propostaModalidade, setPropostaModalidade] = useState(
    initialFamily === "proposta"
      ? (template!.modalidade as string)
      : PROPOSTA_MODALIDADES[0].value
  );
  const [locacaoModalidade, setLocacaoModalidade] = useState<string>(
    initialFamily === "locacao" ? (template!.modalidade as string) : LOCACAO_MODALIDADES[0]
  );

  // Modalidade efetiva do template — em venda é derivada da categoria.
  const modalidade =
    family === "proposta"
      ? propostaModalidade
      : family === "locacao"
        ? locacaoModalidade
        : modalidadeForCategory(category);
  const groupLabel = GROUP_LABELS[CATEGORY_TO_GROUP[category]];

  // ——— Variante do template pelas escolhas do form (locação e proposta) ———
  // "any" = critério não usado (Radix Select não aceita value=""). O contrato de
  // administração fica de fora: `selectAdministracaoTemplate` é match exato de
  // modalidade, sem variante.
  const initialCriteria = parseMatchCriteria(template?.matchCriteria);
  const [criteriaGarantia, setCriteriaGarantia] = useState<string>(
    initialCriteria?.garantia ?? "any"
  );
  const [criteriaFiador, setCriteriaFiador] = useState<string>(
    initialCriteria?.fiadorPessoa ?? "any"
  );
  const [criteriaPessoa, setCriteriaPessoa] = useState<string>(initialCriteria?.pessoa ?? "any");

  const showCriteria =
    family === "proposta" ||
    (family === "locacao" && locacaoModalidade !== ADMINISTRACAO_LOCACAO_MODALIDADE);
  const proponenteLabel = family === "proposta" ? "proponente" : "locatário";

  function buildMatchCriteria(): TemplateMatchCriteria | null {
    if (!showCriteria) return null;
    const c: TemplateMatchCriteria = {};
    if (criteriaGarantia !== "any") {
      c.garantia = criteriaGarantia as TemplateMatchCriteria["garantia"];
      // Fiador PF/PJ só faz sentido (e só desclassifica) junto de garantia=fiador.
      if (criteriaGarantia === "fiador" && criteriaFiador !== "any") {
        c.fiadorPessoa = criteriaFiador as TemplateMatchCriteria["fiadorPessoa"];
      }
    }
    if (criteriaPessoa !== "any") {
      c.pessoa = criteriaPessoa as TemplateMatchCriteria["pessoa"];
    }
    return Object.keys(c).length ? c : null;
  }

  const engine = template?.engine || "handlebars";
  const canPreview =
    mode === "edit" &&
    !!template?.id &&
    (engine === "google_docs"
      ? !!template?.googleTemplateDocId
      : handlebarsSource.length > 0);

  async function handleSave() {
    if (!name.trim() || !handlebarsSource.trim()) {
      toast.error("Nome e conteudo do template sao obrigatorios.");
      return;
    }

    setSaving(true);
    try {
      // Venda manda `category` E a `modalidade` derivada dela. Só a categoria
      // não basta: `resolveTemplateTaxonomy` só deriva modalidade de categoria
      // quando o template JÁ é de venda — mover um template de locação/proposta
      // PARA venda exige a modalidade explícita, senão o PATCH era um no-op
      // silencioso com toast de sucesso.
      const payload =
        family === "venda"
          ? {
              name,
              description,
              handlebarsSource,
              category,
              modalidade: modalidadeForCategory(category),
              isDefault,
              version,
            }
          : {
              name,
              description,
              handlebarsSource,
              modalidade,
              isDefault,
              version,
              // Sempre presente (null limpa) — senão desmarcar um critério na
              // tela não apagaria o que já está gravado.
              matchCriteria: buildMatchCriteria(),
            };

      const url = mode === "create" ? "/api/templates" : `/api/templates/${template!.id}`;
      const method = mode === "create" ? "POST" : "PATCH";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        toast.success(mode === "create" ? "Template criado!" : "Template salvo!");
        router.push("/templates");
        router.refresh();
      } else {
        const data = await res.json();
        toast.error(data.error || "Erro ao salvar template");
      }
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const res = await fetch(`/api/templates/${template!.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Template removido!");
      router.push("/templates");
      router.refresh();
    } else {
      const data = await res.json();
      toast.error(data.error || "Erro ao excluir");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/templates">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Templates
          </Link>
        </Button>
        <h1 className="font-display tracking-tight text-2xl font-semibold">
          {mode === "create" ? "Novo Template" : `Editar: ${template?.name}`}
        </h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Nome</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: CCV - Pagamento A Vista" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="version">Versão</Label>
          <Input id="version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0" />
        </div>
        <div className="space-y-2">
          <Label>Tipo de documento</Label>
          <Select value={family} onValueChange={(v) => setFamily(v as TemplateFamily)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="venda">Contrato de venda</SelectItem>
              <SelectItem value="locacao">Contrato de locação</SelectItem>
              <SelectItem value="proposta">Proposta (oferta pré-contrato)</SelectItem>
            </SelectContent>
          </Select>
          {family === "locacao" ? (
            <>
              <Label htmlFor="loc-modalidade" className="pt-2 block">
                Modalidade de locação
              </Label>
              <Select value={locacaoModalidade} onValueChange={setLocacaoModalidade}>
                <SelectTrigger id="loc-modalidade">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOCACAO_MODALIDADES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {modalidadeLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                O contrato de locação não tem “forma de pagamento” — a esteira usa
                esta modalidade pra achar o template. Marque como principal pra ser
                o padrão da modalidade.
              </p>
            </>
          ) : family === "proposta" ? (
            <>
              <Label htmlFor="prop-modalidade" className="pt-2 block">Modelo de proposta</Label>
              <Select value={propostaModalidade} onValueChange={setPropostaModalidade}>
                <SelectTrigger id="prop-modalidade">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROPOSTA_MODALIDADES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                A proposta usa este modelo por (imobiliária, tipo). Marque como principal pra ser o padrão.
              </p>
            </>
          ) : (
            <>
              <Label htmlFor="category" className="pt-2 block">Categoria (forma de pagamento)</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as TemplateCategory)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>{GROUP_LABELS.sem_alienacao}</SelectLabel>
                    {TEMPLATE_CATEGORIES.filter((c) => CATEGORY_TO_GROUP[c] === "sem_alienacao").map((c) => (
                      <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>{GROUP_LABELS.com_alienacao}</SelectLabel>
                    {TEMPLATE_CATEGORIES.filter((c) => CATEGORY_TO_GROUP[c] === "com_alienacao").map((c) => (
                      <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Grupo: {groupLabel}. A forma de pagamento do negócio puxa esta categoria automaticamente.
              </p>
            </>
          )}
        </div>
        <div className="flex items-start gap-3 pt-6">
          <Switch id="isDefault" checked={isDefault} onCheckedChange={setIsDefault} />
          <div className="grid gap-0.5">
            <Label htmlFor="isDefault">
              {family === "venda" ? "Principal do grupo (fallback)" : "Principal da modalidade"}
            </Label>
            <p className="text-xs text-muted-foreground">
              {family === "venda" ? (
                <>
                  Usado quando uma categoria do grupo “{groupLabel}” não tiver template próprio
                  (ex.: consórcio sem modelo usa o principal de “com alienação fiduciária”).
                  Marcar desfaz o principal atual do mesmo grupo.
                </>
              ) : (
                <>
                  Template usado por padrão em “{modalidadeLabel(modalidade)}”. Marcar
                  desfaz o principal atual da mesma modalidade.
                </>
              )}
            </p>
          </div>
        </div>

        {showCriteria && (
          <div className="md:col-span-2 space-y-3 rounded-md border border-dashed p-3">
            <div>
              <Label>Variante (opcional)</Label>
              <p className="text-xs text-muted-foreground pt-0.5">
                Quando a imobiliária tem mais de um modelo da mesma modalidade, estes
                critérios dizem qual usar: a esteira lê as escolhas do formulário e
                escolhe a variante que bate. Deixe em “Qualquer” para o modelo genérico
                — ele continua sendo o padrão quando nenhuma variante casa.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="criteria-garantia" className="text-xs">
                  Garantia
                </Label>
                <Select value={criteriaGarantia} onValueChange={setCriteriaGarantia}>
                  <SelectTrigger id="criteria-garantia">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Qualquer</SelectItem>
                    {GARANTIA_TIPOS.map((g) => (
                      <SelectItem key={g} value={g}>
                        {GARANTIA_LABELS[g]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {criteriaGarantia === "fiador" && (
                <div className="space-y-1.5">
                  <Label htmlFor="criteria-fiador" className="text-xs">
                    Tipo de fiador
                  </Label>
                  <Select value={criteriaFiador} onValueChange={setCriteriaFiador}>
                    <SelectTrigger id="criteria-fiador">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Qualquer</SelectItem>
                      <SelectItem value="pf">Pessoa física</SelectItem>
                      <SelectItem value="pj">Pessoa jurídica</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="criteria-pessoa" className="text-xs">
                  Tipo de {proponenteLabel}
                </Label>
                <Select value={criteriaPessoa} onValueChange={setCriteriaPessoa}>
                  <SelectTrigger id="criteria-pessoa">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Qualquer</SelectItem>
                    <SelectItem value="pf">Pessoa física</SelectItem>
                    <SelectItem value="pj">Pessoa jurídica</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Descrição</Label>
        <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descrição breve do template" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="source">Conteudo do Template (Handlebars)</Label>
        <Textarea
          id="source"
          value={handlebarsSource}
          onChange={(e) => setHandlebarsSource(e.target.value)}
          placeholder="<!-- Template Handlebars aqui -->"
          className="font-mono text-xs min-h-[500px]"
        />
      </div>

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-1" />
          {saving ? "Salvando..." : mode === "create" ? "Criar Template" : "Salvar Alterações"}
        </Button>

        {canPreview && (
          <Button
            variant="outline"
            onClick={() => setPreviewOpen(true)}
            title="Renderiza o modelo com dados de exemplo"
          >
            <Eye className="h-4 w-4 mr-1" />
            Visualizar preview
          </Button>
        )}

        {mode === "edit" && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">
                <Trash2 className="h-4 w-4 mr-1" />
                Excluir
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir template?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se existem contratos usando este template, ele sera arquivado ao inves de excluido.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>Confirmar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {canPreview && template && (
        <TemplatePreview
          templateId={template.id}
          templateName={name}
          templateModalidade={modalidade}
          templateEngine={engine as "handlebars" | "google_docs"}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
        />
      )}
    </div>
  );
}
