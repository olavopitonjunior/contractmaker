"use client";

import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, Save } from "lucide-react";
import { toast } from "sonner";

interface Item {
  id: string;
  category: string;
  title: string;
  content: string;
  tags: string[];
  source: string | null;
}

interface Props {
  open: boolean;
  item: Item | null;
  onClose: () => void;
  onSaved: () => void;
}

export function KnowledgeItemForm({ open, item, onClose, onSaved }: Props) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<string>("legislation");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [source, setSource] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(item?.title || "");
      setContent(item?.content || "");
      setCategory(item?.category || "legislation");
      setTags(item?.tags || []);
      setSource(item?.source || "");
      setTagInput("");
    }
  }, [open, item]);

  function addTag() {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) {
      setTags([...tags, t]);
      setTagInput("");
    }
  }
  function removeTag(t: string) {
    setTags(tags.filter((x) => x !== t));
  }

  async function handleSave() {
    if (!title.trim() || !content.trim()) {
      toast.error("Título e conteúdo são obrigatórios");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title,
        content,
        category,
        tags,
        source: source || undefined,
      };
      const url = item ? `/api/knowledge/${item.id}` : "/api/knowledge";
      const method = item ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast.success(item ? "Item atualizado" : "Item criado");
        onSaved();
      } else {
        const data = await res.json();
        toast.error(data.error || "Erro ao salvar");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="overflow-y-auto w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>
            {item ? `Editar: ${item.title}` : "Novo item na base de conhecimento"}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 mt-6">
          <div className="space-y-2">
            <Label>Categoria</Label>
            <Select value={category} onValueChange={setCategory} disabled={!!item}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="legislation">Legislação</SelectItem>
                <SelectItem value="model">Modelo Referencial</SelectItem>
                <SelectItem value="rule">Regra do Escritório</SelectItem>
                <SelectItem value="glossary">Glossário</SelectItem>
              </SelectContent>
            </Select>
            {item && (
              <p className="text-[10px] text-muted-foreground">
                A categoria não pode ser alterada após a criação.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Título</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Código Civil — art. 417 (arras)"
            />
          </div>

          <div className="space-y-2">
            <Label>Conteúdo</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Cole o texto completo. Textos longos são divididos em chunks automaticamente."
              className="min-h-[240px] font-mono text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              {content.length} caracteres · aproximadamente {Math.ceil(content.length / 4)} tokens
            </p>
          </div>

          <div className="space-y-2">
            <Label>Fonte (opcional)</Label>
            <Input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="URL, ID do documento, ou 'manual'"
            />
          </div>

          <div className="space-y-2">
            <Label>Tags</Label>
            <div className="flex gap-2">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && (e.preventDefault(), addTag())
                }
                placeholder="Adicionar tag"
              />
              <Button type="button" variant="outline" size="sm" onClick={addTag}>
                +
              </Button>
            </div>
            <div className="flex flex-wrap gap-1 mt-1">
              {tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="text-xs cursor-pointer"
                  onClick={() => removeTag(tag)}
                >
                  {tag} <X className="h-3 w-3 ml-1" />
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-4 border-t">
            <Button onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4 mr-1" />
              {saving ? "Salvando…" : item ? "Salvar" : "Criar"}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
