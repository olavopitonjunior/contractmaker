"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Plus, Trash2, Star, Save, Palette } from "lucide-react";
import { toast } from "sonner";

interface DocumentStyle {
  id: string;
  name: string;
  isDefault: boolean;
  fontFamily: string;
  fontSizeBase: number;
  lineHeight: number;
  marginTopMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  marginRightMm: number;
  colorPrimary: string;
  colorAccent: string;
  headerHtml: string | null;
  footerHtml: string | null;
  pageNumbers: boolean;
  includeToc: boolean;
}

interface Props {
  initialStyles: DocumentStyle[];
}

const FONT_FAMILIES = [
  "Times New Roman",
  "Arial",
  "Calibri",
  "Georgia",
  "Courier New",
  "Helvetica",
];

function StylePreview({ style }: { style: DocumentStyle }) {
  return (
    <div
      className="rounded border bg-white p-4 text-[10px] overflow-hidden"
      style={{
        fontFamily: style.fontFamily,
        fontSize: `${style.fontSizeBase * 0.6}pt`,
        lineHeight: style.lineHeight,
        color: style.colorPrimary,
      }}
    >
      <div style={{ color: style.colorAccent, fontWeight: "bold", marginBottom: 4 }}>
        CONTRATO DE EXEMPLO
      </div>
      <p>
        Pelo presente instrumento particular, as partes acima qualificadas celebram o
        presente contrato de compra e venda...
      </p>
    </div>
  );
}

const BLANK_STYLE: DocumentStyle = {
  id: "",
  name: "",
  isDefault: false,
  fontFamily: "Times New Roman",
  fontSizeBase: 12,
  lineHeight: 1.5,
  marginTopMm: 25,
  marginBottomMm: 25,
  marginLeftMm: 25,
  marginRightMm: 25,
  colorPrimary: "#000000",
  colorAccent: "#C97B0A",
  headerHtml: null,
  footerHtml: null,
  pageNumbers: true,
  includeToc: false,
};

export function DocumentStylesClient({ initialStyles }: Props) {
  const router = useRouter();
  const [styles, setStyles] = useState(initialStyles);
  const [form, setForm] = useState<DocumentStyle | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);

  const current = form;

  function startCreate() {
    setForm({ ...BLANK_STYLE });
    setIsNew(true);
  }

  function startEdit(style: DocumentStyle) {
    setForm({ ...style });
    setIsNew(false);
  }

  function cancel() {
    setForm(null);
    setIsNew(false);
  }

  async function handleSave() {
    if (!form || !form.name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    setSaving(true);
    try {
      const url = isNew ? "/api/document-styles" : `/api/document-styles/${form.id}`;
      const method = isNew ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(isNew ? "Preset criado" : "Preset atualizado");
        if (isNew) {
          setStyles((prev) => [...prev, data]);
        } else {
          setStyles((prev) => prev.map((s) => (s.id === form.id ? data : s)));
        }
        setForm(null);
        setIsNew(false);
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Erro ao salvar");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remover este preset?")) return;
    const res = await fetch(`/api/document-styles/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Removido");
      setStyles((prev) => prev.filter((s) => s.id !== id));
      router.refresh();
    }
  }

  async function setDefault(id: string) {
    const res = await fetch(`/api/document-styles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDefault: true }),
    });
    if (res.ok) {
      toast.success("Definido como padrão");
      setStyles((prev) =>
        prev.map((s) => ({ ...s, isDefault: s.id === id }))
      );
      router.refresh();
    }
  }

  function updateField<K extends keyof DocumentStyle>(key: K, value: DocumentStyle[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link href="/settings">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Configurações
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Palette className="h-6 w-6 text-primary" />
          Estilos de Documento
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Presets de fonte, margens, cores e cabeçalho/rodapé aplicáveis aos contratos
          do escritório. O preset marcado como padrão é usado em novos contratos e na
          exportação PDF.
        </p>
      </div>

      {current ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {isNew ? "Novo preset" : `Editar: ${current.name || "(sem nome)"}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input
                  value={current.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  placeholder="Ex: Contrato Formal"
                />
              </div>
              <div className="space-y-2">
                <Label>Família da fonte</Label>
                <Select
                  value={current.fontFamily}
                  onValueChange={(v) => updateField("fontFamily", v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FONT_FAMILIES.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tamanho base (pt)</Label>
                <Input
                  type="number"
                  min={8}
                  max={24}
                  value={current.fontSizeBase}
                  onChange={(e) =>
                    updateField("fontSizeBase", parseInt(e.target.value, 10) || 12)
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Espaçamento entre linhas</Label>
                <Input
                  type="number"
                  step={0.05}
                  min={1}
                  max={3}
                  value={current.lineHeight}
                  onChange={(e) =>
                    updateField("lineHeight", parseFloat(e.target.value) || 1.5)
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Margens (mm)</Label>
              <div className="grid grid-cols-4 gap-2">
                {(["Top", "Right", "Bottom", "Left"] as const).map((side) => {
                  const key = `margin${side}Mm` as const;
                  return (
                    <div key={side}>
                      <p className="text-[10px] text-muted-foreground mb-1">{side}</p>
                      <Input
                        type="number"
                        min={0}
                        max={60}
                        value={current[key] as number}
                        onChange={(e) =>
                          updateField(key, parseInt(e.target.value, 10) || 25)
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Cor primária</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="color"
                    value={current.colorPrimary}
                    onChange={(e) => updateField("colorPrimary", e.target.value)}
                    className="h-9 w-16 p-1"
                  />
                  <Input
                    value={current.colorPrimary}
                    onChange={(e) => updateField("colorPrimary", e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Cor de destaque</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="color"
                    value={current.colorAccent}
                    onChange={(e) => updateField("colorAccent", e.target.value)}
                    className="h-9 w-16 p-1"
                  />
                  <Input
                    value={current.colorAccent}
                    onChange={(e) => updateField("colorAccent", e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Cabeçalho HTML (opcional — aparece em todas as páginas do PDF)</Label>
              <Textarea
                value={current.headerHtml || ""}
                onChange={(e) => updateField("headerHtml", e.target.value || null)}
                placeholder='<div style="font-size:9pt;text-align:right;">Escritório Fulano</div>'
                className="font-mono text-xs min-h-[60px]"
              />
            </div>

            <div className="space-y-2">
              <Label>Rodapé HTML (opcional — use &lt;span class="pageNumber"&gt; e &lt;span class="totalPages"&gt;)</Label>
              <Textarea
                value={current.footerHtml || ""}
                onChange={(e) => updateField("footerHtml", e.target.value || null)}
                placeholder='<div style="font-size:9pt;text-align:center;"><span class="pageNumber"></span>/<span class="totalPages"></span></div>'
                className="font-mono text-xs min-h-[60px]"
              />
            </div>

            <div className="flex items-center gap-6 flex-wrap pt-2">
              <div className="flex items-center gap-2">
                <Switch
                  checked={current.pageNumbers}
                  onCheckedChange={(v) => updateField("pageNumbers", v)}
                />
                <Label>Numeração de páginas</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={current.includeToc}
                  onCheckedChange={(v) => updateField("includeToc", v)}
                />
                <Label>Incluir sumário (TOC)</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={current.isDefault}
                  onCheckedChange={(v) => updateField("isDefault", v)}
                />
                <Label>Definir como padrão</Label>
              </div>
            </div>

            <div className="pt-2">
              <p className="text-xs font-medium text-muted-foreground mb-2">Preview</p>
              <StylePreview style={current} />
            </div>

            <div className="flex gap-2 pt-4 border-t">
              <Button onClick={handleSave} disabled={saving}>
                <Save className="h-4 w-4 mr-1" />
                {saving ? "Salvando…" : isNew ? "Criar" : "Salvar"}
              </Button>
              <Button variant="ghost" onClick={cancel}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Button onClick={startCreate}>
            <Plus className="h-4 w-4 mr-1" />
            Novo preset
          </Button>

          {styles.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <p>Nenhum preset ainda.</p>
              <p className="mt-1">Crie o primeiro para personalizar a identidade visual dos contratos.</p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {styles.map((style) => (
                <Card key={style.id} className="group">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-sm flex items-center gap-2">
                          {style.name}
                          {style.isDefault && (
                            <Badge className="bg-primary text-primary-foreground text-[10px]">
                              <Star className="h-2.5 w-2.5 mr-0.5" />
                              Padrão
                            </Badge>
                          )}
                        </CardTitle>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {style.fontFamily} · {style.fontSizeBase}pt · linha {style.lineHeight}
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <StylePreview style={style} />
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => startEdit(style)}
                      >
                        Editar
                      </Button>
                      {!style.isDefault && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDefault(style.id)}
                        >
                          <Star className="h-3 w-3 mr-1" />
                          Tornar padrão
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto text-destructive hover:text-destructive"
                        onClick={() => handleDelete(style.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
