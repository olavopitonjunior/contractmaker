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
  TEMPLATE_CATEGORIES,
  CATEGORY_LABELS,
  CATEGORY_TO_GROUP,
  GROUP_LABELS,
  modalidadeForCategory,
  type TemplateCategory,
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

interface TemplateEditorProps {
  template?: {
    id: string;
    name: string;
    description: string;
    handlebarsSource: string;
    modalidade: string | null;
    category?: string | null;
    isDefault: boolean;
    version: string;
    status: string;
    engine?: string;
    googleTemplateDocId?: string | null;
    previewStale?: boolean;
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

  // Modalidade (grupo) derivada da categoria — usada no preview e nos labels.
  const modalidade = modalidadeForCategory(category);
  const groupLabel = GROUP_LABELS[CATEGORY_TO_GROUP[category]];

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
      const payload = { name, description, handlebarsSource, category, isDefault, version };

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
        <h1 className="text-2xl font-semibold">
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
          <Label htmlFor="category">Categoria (forma de pagamento)</Label>
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
        </div>
        <div className="flex items-start gap-3 pt-6">
          <Switch id="isDefault" checked={isDefault} onCheckedChange={setIsDefault} />
          <div className="grid gap-0.5">
            <Label htmlFor="isDefault">Principal do grupo (fallback)</Label>
            <p className="text-xs text-muted-foreground">
              Usado quando uma categoria do grupo “{groupLabel}” não tiver template próprio
              (ex.: consórcio sem modelo usa o principal de “com alienação fiduciária”).
              Marcar desfaz o principal atual do mesmo grupo.
            </p>
          </div>
        </div>
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
            title={
              template?.previewStale
                ? "Preview desatualizado — abre o último upload e oferece atualizar"
                : "Abrir preview embedado no Google Docs"
            }
          >
            <Eye className="h-4 w-4 mr-1" />
            Visualizar preview
            {template?.previewStale && (
              <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
            )}
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
          templateModalidade={modalidade as "a_vista" | "financiamento"}
          templateEngine={engine as "handlebars" | "google_docs"}
          previewStale={template.previewStale ?? false}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
        />
      )}
    </div>
  );
}
