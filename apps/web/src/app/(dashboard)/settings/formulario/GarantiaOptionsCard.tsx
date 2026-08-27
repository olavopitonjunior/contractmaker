"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, FileText, Plus, Trash2 } from "lucide-react";
import {
  GARANTIA_LABELS,
  type GarantiaTipo,
} from "@/lib/contracts/template-category";
import {
  TIPOS_COM_GARANTIDOR,
  type GarantiaOptionLike,
} from "@/lib/forms/garantia-catalog";
import {
  providerTag,
  slotTagsFor,
  slugifyProviderTag,
} from "@/lib/templates/clause-slots";

/**
 * Seguradoras e prestadoras de garantia da imobiliária.
 *
 * Taxonomia (decisão do dono, 28/08): os TIPOS de garantia são fixos do
 * sistema — o tenant não cria nem edita tipos. O que se cadastra aqui são as
 * EMPRESAS (Loft, CredPago, Porto Seguro…) que atendem os tipos com
 * prestadora. No formulário de locação a prestadora é um segundo campo, depois
 * do tipo.
 *
 * Cada prestadora pode ter uma CLÁUSULA PRÓPRIA no acervo (KnowledgeItem
 * aprovado com tags `slot:garantia` + `garantia:<tipo>` + `provider:<slug>`).
 * Se tiver, a geração injeta a redação dela MECANICAMENTE no slot do template
 * (`rankSlotCandidates`: prestadora exata > genérica do tipo > fallback
 * neutro); se não, vale a genérica do tipo. O botão "Adicionar cláusula" grava
 * direto no acervo com as três tags.
 */

interface Props {
  initial: GarantiaOptionLike[];
  /**
   * Slugs de prestadora com cláusula própria APROVADA no acervo, por tipo —
   * calculado server-side (`providerSlugsByGarantiaFromTags`).
   */
  clauseSlugsByTipo?: Partial<Record<string, string[]>>;
}

export function GarantiaOptionsCard({ initial, clauseSlugsByTipo = {} }: Props) {
  const [options, setOptions] = useState<GarantiaOptionLike[]>(initial);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftTipo, setDraftTipo] = useState<GarantiaTipo>("seguro_fianca");
  const [draftProvider, setDraftProvider] = useState("");
  // Cláusulas criadas NESTA sessão da tela — flipam o estado sem reload.
  const [addedClauses, setAddedClauses] = useState<Set<string>>(new Set());
  const [clauseFor, setClauseFor] = useState<{
    tipo: GarantiaTipo;
    provider: string;
  } | null>(null);

  function hasOwnClause(tipo: string, provider: string): boolean {
    const slug = slugifyProviderTag(provider);
    if (!slug) return false;
    if (addedClauses.has(`${tipo}:${slug}`)) return true;
    return (clauseSlugsByTipo[tipo] ?? []).includes(slug);
  }

  async function createOption() {
    const provider = draftProvider.trim();
    if (provider.length < 2) {
      toast.error("Informe o nome da prestadora");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/org/garantia-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: draftTipo, provider }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Falha ao cadastrar");
        return;
      }
      // A primeira gravação materializa os defaults no banco (ver a rota) —
      // recarrega a lista inteira pra tela não mentir sobre o que existe.
      const refreshed = await fetch("/api/org/garantia-options")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      setOptions(
        refreshed?.options ?? [...options, data.option as GarantiaOptionLike],
      );
      setDraftProvider("");
      setCreating(false);
      toast.success("Prestadora cadastrada — já aparece no formulário");
    } finally {
      setBusy(false);
    }
  }

  async function patchOption(id: string, body: Record<string, unknown>) {
    const before = options;
    setOptions((prev) =>
      prev.map((o) => (o.id === id ? { ...o, ...body } : o)),
    );
    const res = await fetch(`/api/org/garantia-options/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setOptions(before);
      toast.error(data.error || "Falha ao salvar");
    }
  }

  async function removeOption(id: string) {
    const res = await fetch(`/api/org/garantia-options/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || "Falha ao excluir");
      return;
    }
    setOptions((prev) => prev.filter((o) => o.id !== id));
    toast.success("Prestadora removida");
  }

  const persisted = options.filter((o) => o.id);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Seguradoras e prestadoras de garantia</CardTitle>
        <CardDescription>
          Aqui você cadastra as empresas com que a imobiliária trabalha — os
          tipos de garantia (fiador, caução, seguro fiança…) são fixos do
          sistema. No formulário de locação, quem preenche escolhe primeiro o
          tipo e depois a prestadora; se a prestadora tiver cláusula própria no
          acervo, o contrato sai com a redação dela.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {persisted.length === 0 && options.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Você ainda não personalizou o catálogo — o formulário está usando a
            lista sugerida abaixo. Cadastrar a primeira prestadora salva a lista
            atual e acrescenta a nova.
          </p>
        )}

        <div className="space-y-2">
          {options.map((opt, idx) => {
            const ownClause = hasOwnClause(opt.tipo, opt.provider);
            return (
              <div
                key={opt.id ?? `${opt.tipo}-${opt.provider}-${idx}`}
                className="flex items-center justify-between gap-3 rounded-lg border p-3 flex-wrap"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {opt.label ||
                        opt.provider ||
                        GARANTIA_LABELS[opt.tipo as GarantiaTipo]}
                    </span>
                    <Badge variant="secondary">
                      {GARANTIA_LABELS[opt.tipo as GarantiaTipo] ?? opt.tipo}
                    </Badge>
                    {opt.active === false && (
                      <Badge variant="outline">Desativada</Badge>
                    )}
                    {!opt.id && <Badge variant="outline">Sugerida</Badge>}
                  </div>
                  {opt.provider && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      {ownClause ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-600" />
                          cláusula própria no acervo
                        </>
                      ) : (
                        <>— usa a cláusula genérica do tipo</>
                      )}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {opt.provider && !ownClause && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setClauseFor({
                          tipo: opt.tipo as GarantiaTipo,
                          provider: opt.provider,
                        })
                      }
                    >
                      <FileText className="h-3.5 w-3.5 mr-1" />
                      Adicionar cláusula
                    </Button>
                  )}
                  {opt.id && (
                    <>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Switch
                          checked={opt.active !== false}
                          onCheckedChange={(active) =>
                            patchOption(opt.id as string, { active })
                          }
                        />
                        Ativa
                      </label>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => removeOption(opt.id as string)}
                        title="Excluir (prefira desativar)"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {creating ? (
          <div className="rounded-lg border p-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
              <div className="space-y-1.5">
                <Label className="text-xs">Tipo de garantia</Label>
                <Select
                  value={draftTipo}
                  onValueChange={(v) => setDraftTipo(v as GarantiaTipo)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS_COM_GARANTIDOR.map((t) => (
                      <SelectItem key={t} value={t}>
                        {GARANTIA_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="new-garantia-provider">
                  Prestadora
                </Label>
                <Input
                  id="new-garantia-provider"
                  value={draftProvider}
                  placeholder="Ex.: Porto Seguro"
                  onChange={(e) => setDraftProvider(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={createOption} disabled={busy}>
                {busy ? "Salvando…" : "Cadastrar"}
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
            Nova prestadora
          </Button>
        )}
      </CardContent>

      {clauseFor && (
        <ProviderClauseDialog
          tipo={clauseFor.tipo}
          provider={clauseFor.provider}
          onClose={() => setClauseFor(null)}
          onCreated={() => {
            setAddedClauses((prev) => {
              const next = new Set(prev);
              next.add(
                `${clauseFor.tipo}:${slugifyProviderTag(clauseFor.provider)}`,
              );
              return next;
            });
            setClauseFor(null);
          }}
        />
      )}
    </Card>
  );
}

/**
 * Grava a cláusula da prestadora no acervo com as TRÊS tags que a geração usa
 * pra eleger mecanicamente (`slot:garantia` + `garantia:<tipo>` +
 * `provider:<slug>`). Nasce aprovada (default do POST /api/knowledge) — o
 * próximo contrato daquela prestadora já sai com esta redação.
 */
function ProviderClauseDialog({
  tipo,
  provider,
  onClose,
  onCreated,
}: {
  tipo: GarantiaTipo;
  provider: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const title = `Cláusula de garantia — ${GARANTIA_LABELS[tipo]} — ${provider}`;

  async function save() {
    if (content.trim().length < 40) {
      toast.error("Cole o texto completo da cláusula (mínimo 40 caracteres)");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content: content.trim(),
          category: "clause",
          tags: [...slotTagsFor("garantia", tipo), providerTag(provider)],
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Falha ao salvar a cláusula");
        return;
      }
      toast.success(
        "Cláusula salva no acervo — os próximos contratos desta prestadora já usam esta redação",
      );
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            O texto entra no acervo de cláusulas e é injetado no contrato sempre
            que o formulário escolher {GARANTIA_LABELS[tipo].toLowerCase()} com{" "}
            {provider}.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={10}
          placeholder="Cole aqui o texto da cláusula desta prestadora…"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Salvando…" : "Salvar no acervo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
