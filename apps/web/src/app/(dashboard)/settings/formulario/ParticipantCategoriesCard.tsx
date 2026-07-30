"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import {
  CATEGORY_FIELD_TYPES,
  CATEGORY_FIELD_TYPE_LABELS,
  slugifyCategoryLabel,
  type CategoryFieldDef,
  type CategoryFieldType,
  type CategoryModule,
  type ParticipantCategory,
} from "@/lib/forms/participant-category";

/**
 * Categorias de TERCEIRO do link por parte: a imobiliária cria a categoria
 * (interveniente anuente, gestor do condomínio…) e declara os campos que quer
 * coletar. Os 5 papéis nativos não aparecem aqui — são fixos em código.
 *
 * Categoria com link já emitido não pode ser excluída (a API devolve 409); o
 * caminho é DESATIVAR, que a tira da geração de links novos sem quebrar quem
 * já recebeu o dele.
 */

interface Props {
  initial: ParticipantCategory[];
  locacaoEnabled: boolean;
}

const emptyField = (): CategoryFieldDef => ({
  key: "",
  label: "",
  type: "text",
  required: false,
});

export function ParticipantCategoriesCard({ initial, locacaoEnabled }: Props) {
  const [categories, setCategories] = useState<ParticipantCategory[]>(initial);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftModules, setDraftModules] = useState<CategoryModule[]>(["venda"]);

  async function createCategory() {
    const label = draftLabel.trim();
    if (label.length < 2) {
      toast.error("Dê um nome à categoria");
      return;
    }
    if (draftModules.length === 0) {
      toast.error("Escolha ao menos um módulo");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/org/participant-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          slug: slugifyCategoryLabel(label),
          appliesTo: draftModules,
          fields: [],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Falha ao criar categoria");
        return;
      }
      setCategories((prev) => [...prev, data.category as ParticipantCategory]);
      setDraftLabel("");
      setCreating(false);
      toast.success("Categoria criada — agora configure os campos");
    } finally {
      setBusy(false);
    }
  }

  async function patchCategory(
    id: string,
    body: Record<string, unknown>,
    optimistic: (c: ParticipantCategory) => ParticipantCategory,
  ) {
    const before = categories;
    setCategories((prev) => prev.map((c) => (c.id === id ? optimistic(c) : c)));
    const res = await fetch(`/api/org/participant-categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setCategories(before);
      toast.error(data.error || "Falha ao salvar");
      return false;
    }
    return true;
  }

  async function removeCategory(id: string) {
    const res = await fetch(`/api/org/participant-categories/${id}`, {
      method: "DELETE",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error || "Falha ao excluir");
      return;
    }
    setCategories((prev) => prev.filter((c) => c.id !== id));
    toast.success("Categoria excluída");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Links para terceiros</CardTitle>
        <CardDescription>
          Além de vendedor/comprador (e locador/locatário/fiador), você pode
          criar categorias próprias — interveniente anuente, gestor do
          condomínio, procurador externo — cada uma com os campos que a sua
          imobiliária precisa coletar. Elas aparecem no painel &ldquo;Links por
          parte&rdquo; do formulário.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {categories.length === 0 && !creating && (
          <p className="text-sm text-muted-foreground">
            Nenhuma categoria criada ainda.
          </p>
        )}

        {categories.map((cat) => (
          <CategoryRow
            key={cat.id}
            category={cat}
            locacaoEnabled={locacaoEnabled}
            onPatch={patchCategory}
            onDelete={removeCategory}
          />
        ))}

        {creating ? (
          <div className="rounded-lg border p-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-category-label">Nome da categoria</Label>
              <Input
                id="new-category-label"
                value={draftLabel}
                placeholder="Ex.: Interveniente anuente"
                onChange={(e) => setDraftLabel(e.target.value)}
              />
              {draftLabel.trim().length >= 2 && (
                <p className="text-xs text-muted-foreground">
                  Identificador: <code>{slugifyCategoryLabel(draftLabel)}</code>{" "}
                  (não muda depois de criado)
                </p>
              )}
            </div>
            <ModulePicker
              value={draftModules}
              locacaoEnabled={locacaoEnabled}
              onChange={setDraftModules}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={createCategory} disabled={busy}>
                {busy ? "Criando…" : "Criar categoria"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCreating(false)}
                disabled={busy}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Nova categoria
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function ModulePicker({
  value,
  locacaoEnabled,
  onChange,
}: {
  value: CategoryModule[];
  locacaoEnabled: boolean;
  onChange: (next: CategoryModule[]) => void;
}) {
  const toggle = (mod: CategoryModule) =>
    onChange(
      value.includes(mod) ? value.filter((m) => m !== mod) : [...value, mod],
    );
  return (
    <div className="flex items-center gap-4">
      <span className="text-sm text-muted-foreground">Disponível em:</span>
      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={value.includes("venda")}
          onCheckedChange={() => toggle("venda")}
        />
        Vendas
      </label>
      {locacaoEnabled && (
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={value.includes("locacao")}
            onCheckedChange={() => toggle("locacao")}
          />
          Locação
        </label>
      )}
    </div>
  );
}

function CategoryRow({
  category,
  locacaoEnabled,
  onPatch,
  onDelete,
}: {
  category: ParticipantCategory;
  locacaoEnabled: boolean;
  onPatch: (
    id: string,
    body: Record<string, unknown>,
    optimistic: (c: ParticipantCategory) => ParticipantCategory,
  ) => Promise<boolean>;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<CategoryFieldDef[]>(category.fields);
  const [saving, setSaving] = useState(false);

  function updateField(idx: number, patch: Partial<CategoryFieldDef>) {
    setFields((prev) =>
      prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)),
    );
  }

  async function saveFields() {
    // Chave vazia é derivada do label (o usuário não precisa pensar nela);
    // duplicata é rejeitada pelo Zod do servidor, então avisamos antes.
    const normalized = fields.map((f) => ({
      ...f,
      key: f.key.trim() || slugifyCategoryLabel(f.label).replace(/-/g, "_"),
      label: f.label.trim(),
    }));
    if (normalized.some((f) => !f.label || !f.key)) {
      toast.error("Todo campo precisa de um nome");
      return;
    }
    if (new Set(normalized.map((f) => f.key)).size !== normalized.length) {
      toast.error("Há campos com o mesmo identificador");
      return;
    }
    setSaving(true);
    try {
      const ok = await onPatch(category.id, { fields: normalized }, (c) => ({
        ...c,
        fields: normalized,
      }));
      if (ok) {
        setFields(normalized);
        toast.success("Campos salvos");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{category.label}</span>
            <code className="text-xs text-muted-foreground">{category.slug}</code>
            {!category.active && <Badge variant="outline">Desativada</Badge>}
            {category.appliesTo.map((m) => (
              <Badge key={m} variant="secondary">
                {m === "locacao" ? "Locação" : "Vendas"}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {category.fields.length} campo(s) configurado(s)
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              checked={category.active}
              onCheckedChange={(active) =>
                onPatch(category.id, { active }, (c) => ({ ...c, active }))
              }
            />
            Ativa
          </label>
          <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
            {open ? "Fechar" : "Editar campos"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={() => onDelete(category.id)}
            title="Excluir (só se nenhum link foi gerado)"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {open && (
        <div className="space-y-3 border-t pt-3">
          <ModulePicker
            value={category.appliesTo}
            locacaoEnabled={locacaoEnabled}
            onChange={(appliesTo) => {
              if (appliesTo.length === 0) {
                toast.error("Escolha ao menos um módulo");
                return;
              }
              onPatch(category.id, { appliesTo }, (c) => ({ ...c, appliesTo }));
            }}
          />

          {fields.map((field, idx) => (
            <div
              key={idx}
              className="grid gap-2 sm:grid-cols-[1fr_150px_auto_auto] items-end"
            >
              <div className="space-y-1">
                <Label className="text-xs">Nome do campo</Label>
                <Input
                  value={field.label}
                  placeholder="Ex.: Nome completo"
                  onChange={(e) => updateField(idx, { label: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tipo</Label>
                <Select
                  value={field.type}
                  onValueChange={(type) =>
                    updateField(idx, { type: type as CategoryFieldType })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_FIELD_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {CATEGORY_FIELD_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-xs pb-2">
                <Switch
                  checked={field.required}
                  onCheckedChange={(required) => updateField(idx, { required })}
                />
                Obrigatório
              </label>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive mb-1"
                onClick={() =>
                  setFields((prev) => prev.filter((_, i) => i !== idx))
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFields((prev) => [...prev, emptyField()])}
            >
              <Plus className="h-4 w-4 mr-1" />
              Adicionar campo
            </Button>
            <Button size="sm" onClick={saveFields} disabled={saving}>
              {saving ? "Salvando…" : "Salvar campos"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Campos marcados como obrigatórios bloqueiam o envio do link daquela
            pessoa.
          </p>
        </div>
      )}
    </div>
  );
}
