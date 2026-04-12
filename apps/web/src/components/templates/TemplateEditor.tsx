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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Save, Trash2, ArrowLeft } from "lucide-react";
import Link from "next/link";

interface TemplateEditorProps {
  template?: {
    id: string;
    name: string;
    description: string;
    handlebarsSource: string;
    modalidade: string | null;
    isDefault: boolean;
    version: string;
    status: string;
  };
  mode: "create" | "edit";
}

export function TemplateEditor({ template, mode }: TemplateEditorProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(template?.name || "");
  const [description, setDescription] = useState(template?.description || "");
  const [handlebarsSource, setHandlebarsSource] = useState(template?.handlebarsSource || "");
  const [modalidade, setModalidade] = useState(template?.modalidade || "a_vista");
  const [isDefault, setIsDefault] = useState(template?.isDefault || false);
  const [version, setVersion] = useState(template?.version || "1.0.0");

  async function handleSave() {
    if (!name.trim() || !handlebarsSource.trim()) {
      toast.error("Nome e conteudo do template sao obrigatorios.");
      return;
    }

    setSaving(true);
    try {
      const payload = { name, description, handlebarsSource, modalidade, isDefault, version };

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
      toast.error("Erro de conexao");
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
          <Label htmlFor="version">Versao</Label>
          <Input id="version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="modalidade">Modalidade</Label>
          <Select value={modalidade} onValueChange={setModalidade}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="a_vista">A Vista</SelectItem>
              <SelectItem value="financiamento">Financiamento</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-3 pt-6">
          <Switch id="isDefault" checked={isDefault} onCheckedChange={setIsDefault} />
          <Label htmlFor="isDefault">Template padrao</Label>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Descricao</Label>
        <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descricao breve do template" />
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
          {saving ? "Salvando..." : mode === "create" ? "Criar Template" : "Salvar Alteracoes"}
        </Button>

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
    </div>
  );
}
