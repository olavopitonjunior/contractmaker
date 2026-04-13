"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { Save, Trash2, X } from "lucide-react";

interface ClauseData {
  id?: string;
  title: string;
  content: string;
  description: string;
  category: string;
  subcategory: string;
  groupCode: string;
  isVariable: boolean;
  agentNotes: string;
  tags: string[];
  status: string;
}

interface ClauseEditorProps {
  clause?: ClauseData;
  open: boolean;
  onClose: () => void;
  mode: "create" | "edit";
}

export function ClauseEditor({ clause, open, onClose, mode }: ClauseEditorProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(clause?.title || "");
  const [content, setContent] = useState(clause?.content || "");
  const [description, setDescription] = useState(clause?.description || "");
  const [category, setCategory] = useState(clause?.category || "customizada");
  const [groupCode, setGroupCode] = useState(clause?.groupCode || "");
  const [isVariable, setIsVariable] = useState(clause?.isVariable || false);
  const [agentNotes, setAgentNotes] = useState(clause?.agentNotes || "");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>(clause?.tags || []);
  const [status, setStatus] = useState(clause?.status || "approved");

  function addTag() {
    const tag = tagInput.trim();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
      setTagInput("");
    }
  }

  function removeTag(tag: string) {
    setTags(tags.filter((t) => t !== tag));
  }

  async function handleSave() {
    if (!title.trim() || !content.trim()) {
      toast.error("Título e conteúdo são obrigatórios.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        title,
        content,
        description,
        category,
        groupCode: groupCode || null,
        isVariable,
        agentNotes,
        tags,
        status,
      };

      const url = mode === "create" ? "/api/clauses" : `/api/clauses/${clause!.id}`;
      const method = mode === "create" ? "POST" : "PATCH";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        toast.success(mode === "create" ? "Cláusula criada!" : "Cláusula salva!");
        onClose();
        router.refresh();
      } else {
        const data = await res.json();
        toast.error(data.error || "Erro ao salvar cláusula");
      }
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const res = await fetch(`/api/clauses/${clause!.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Cláusula removida!");
      onClose();
      router.refresh();
    } else {
      const data = await res.json();
      toast.error(data.error || "Erro ao excluir");
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="overflow-y-auto w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {mode === "create" ? "Nova Cláusula" : `Editar: ${clause?.title}`}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 mt-6">
          <div className="space-y-2">
            <Label>Título</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título da cláusula" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Ex: preço" />
            </div>
            <div className="space-y-2">
              <Label>Grupo</Label>
              <Select value={groupCode} onValueChange={setGroupCode}>
                <SelectTrigger>
                  <SelectValue placeholder="Nenhum" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  <SelectItem value="G1">G1 - Sinal/Arras</SelectItem>
                  <SelectItem value="G2">G2 - Posse</SelectItem>
                  <SelectItem value="G3">G3 - Rescisão</SelectItem>
                  <SelectItem value="G4">G4 - Financiamento</SelectItem>
                  <SelectItem value="G5">G5 - Comissão</SelectItem>
                  <SelectItem value="G6">G6 - Declarações</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="approved">Aprovada</SelectItem>
                  <SelectItem value="pending">Pendente</SelectItem>
                  <SelectItem value="draft">Rascunho</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 pt-6">
              <Switch checked={isVariable} onCheckedChange={setIsVariable} />
              <Label>Cláusula variável</Label>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Descrição</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descrição breve" />
          </div>

          <div className="space-y-2">
            <Label>Conteúdo (Handlebars)</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Conteúdo da cláusula com {{variáveis}}"
              className="font-mono text-xs min-h-[200px]"
            />
          </div>

          <div className="space-y-2">
            <Label>Notas para o Agente IA</Label>
            <Textarea
              value={agentNotes}
              onChange={(e) => setAgentNotes(e.target.value)}
              placeholder="Orientações para o agente sobre quando usar esta cláusula"
              className="text-xs min-h-[80px]"
            />
          </div>

          <div className="space-y-2">
            <Label>Tags</Label>
            <div className="flex gap-2">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
                placeholder="Adicionar tag"
              />
              <Button type="button" variant="outline" size="sm" onClick={addTag}>
                +
              </Button>
            </div>
            <div className="flex flex-wrap gap-1 mt-1">
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs cursor-pointer" onClick={() => removeTag(tag)}>
                  {tag} <X className="h-3 w-3 ml-1" />
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-4">
            <Button onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4 mr-1" />
              {saving ? "Salvando..." : mode === "create" ? "Criar" : "Salvar"}
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
                    <AlertDialogTitle>Excluir cláusula?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Se a cláusula estiver vinculada a contratos, será arquivada.
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
      </SheetContent>
    </Sheet>
  );
}
