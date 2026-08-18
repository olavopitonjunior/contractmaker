"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Plus, Trash2, Loader2, UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  WITNESS_SCOPES,
  WITNESS_SCOPE_LABEL,
  type WitnessScope,
} from "@/lib/clicksign/witness-scope";

interface Witness {
  id: string;
  nome: string;
  cpf: string | null;
  email: string;
  mobilePhone: string | null;
  isDefault: boolean;
  scope: string;
}

function maskCpf(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function DefaultWitnessesClient({
  embedded = false,
}: { embedded?: boolean } = {}) {
  const [scope, setScope] = useState<WitnessScope>("venda");
  const [witnesses, setWitnesses] = useState<Witness[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    nome: "",
    cpf: "",
    email: "",
    mobilePhone: "",
    isDefault: true,
  });

  async function load(currentScope: WitnessScope) {
    setLoading(true);
    try {
      const res = await fetch(`/api/settings/witnesses?scope=${currentScope}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setWitnesses(data.witnesses ?? []);
      else toast.error(data.error || "Erro ao carregar testemunhas");
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(scope);
  }, [scope]);

  async function handleAdd() {
    if (draft.nome.trim().length < 2) {
      toast.error("Informe o nome completo");
      return;
    }
    if (!EMAIL_REGEX.test(draft.email.trim())) {
      toast.error("E-mail inválido");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings/witnesses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, scope }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success("Testemunha cadastrada");
        setDraft({ nome: "", cpf: "", email: "", mobilePhone: "", isDefault: true });
        load(scope);
      } else {
        toast.error(data.error || "Erro ao cadastrar");
      }
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setSaving(false);
    }
  }

  async function toggleDefault(w: Witness) {
    const res = await fetch(`/api/settings/witnesses/${w.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDefault: !w.isDefault }),
    });
    if (res.ok) {
      setWitnesses((prev) =>
        prev.map((x) => (x.id === w.id ? { ...x, isDefault: !x.isDefault } : x))
      );
    } else {
      toast.error("Erro ao atualizar");
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/settings/witnesses/${id}`, { method: "DELETE" });
    if (res.ok) {
      setWitnesses((prev) => prev.filter((x) => x.id !== id));
      toast.success("Testemunha removida");
    } else {
      toast.error("Erro ao remover");
    }
  }

  return (
    <div className="space-y-6">
      {embedded ? (
        <p className="text-sm text-muted-foreground">
          Cadastre as testemunhas que assinam por padrão, separadas por módulo.
          Na hora do envio, você as escolhe pelo botão{" "}
          <strong>Selecionar testemunhas</strong> — sem redigitar. As marcadas
          como <strong>padrão</strong> já vêm pré-marcadas no seletor.
        </p>
      ) : (
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
            <Link href="/settings">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Configurações
            </Link>
          </Button>
          <h1 className="font-display tracking-tight text-2xl font-semibold">
            Cadastro de testemunhas
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cadastre as testemunhas que assinam por padrão, separadas por módulo.
            Na hora do envio, você as escolhe pelo botão{" "}
            <strong>Selecionar testemunhas</strong> — sem redigitar. As marcadas
            como <strong>padrão</strong> já vêm pré-marcadas no seletor.
          </p>
        </div>
      )}

      <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 gap-0.5">
        {WITNESS_SCOPES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            className={cn(
              "px-3 py-1.5 text-sm rounded-md transition-colors",
              scope === s
                ? "bg-background shadow-xs font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {WITNESS_SCOPE_LABEL[s]}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="h-4 w-4" /> Nova testemunha
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">Nome completo</Label>
              <Input
                value={draft.nome}
                onChange={(e) => setDraft({ ...draft, nome: e.target.value })}
                placeholder="Ex: Márcia Pereira"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">E-mail</Label>
              <Input
                type="email"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                placeholder="email@exemplo.com"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Celular</Label>
              <Input
                value={draft.mobilePhone}
                onChange={(e) =>
                  setDraft({ ...draft, mobilePhone: e.target.value })
                }
                placeholder="(11) 90000-0000"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">CPF (opcional)</Label>
              <Input
                value={maskCpf(draft.cpf)}
                onChange={(e) =>
                  setDraft({ ...draft, cpf: e.target.value.replace(/\D/g, "") })
                }
                placeholder="000.000.000-00"
              />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer self-end pb-2">
              <input
                type="checkbox"
                checked={draft.isDefault}
                onChange={(e) =>
                  setDraft({ ...draft, isDefault: e.target.checked })
                }
                className="h-4 w-4 rounded border-input accent-primary"
              />
              Usar como padrão no envelope
            </label>
          </div>
          <Button onClick={handleAdd} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-1.5" />
            )}
            Cadastrar testemunha
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <UsersRound className="h-4 w-4" /> Testemunhas cadastradas
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
            </div>
          ) : witnesses.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Nenhuma testemunha cadastrada ainda.
            </p>
          ) : (
            <div className="divide-y">
              {witnesses.map((w) => (
                <div
                  key={w.id}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">
                        {w.nome}
                      </span>
                      {w.isDefault && (
                        <Badge variant="default" className="text-[10px]">
                          Padrão
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {w.email}
                      {w.mobilePhone ? ` · ${w.mobilePhone}` : ""}
                      {w.cpf ? ` · ${maskCpf(w.cpf)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={w.isDefault}
                        onChange={() => toggleDefault(w)}
                        className="h-3.5 w-3.5 rounded border-input accent-primary"
                      />
                      Padrão
                    </label>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-destructive hover:text-destructive"
                      onClick={() => remove(w.id)}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Remover
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
