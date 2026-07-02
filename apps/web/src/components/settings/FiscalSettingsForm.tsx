"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export interface FiscalSettings {
  legalName?: string | null;
  cnpj?: string | null;
  creci?: string | null;
  legalAddress?: string | null;
  fiscalResponsibleCpf?: string | null;
  fiscalUf?: string | null;
  fiscalMunicipioCode?: string | null;
  fiscalMunicipioName?: string | null;
}

interface MunicipioHit {
  tom: string;
  uf: string;
  nome: string;
  ibge: string;
}

const FIELDS: {
  key: keyof FiscalSettings;
  label: string;
  placeholder?: string;
  hint?: string;
}[] = [
  { key: "legalName", label: "Razão social", placeholder: "Imobiliária Modelo Ltda" },
  { key: "cnpj", label: "CNPJ", placeholder: "00.000.000/0001-00" },
  { key: "creci", label: "CRECI (opcional)" },
  { key: "legalAddress", label: "Endereço completo", placeholder: "Rua, nº, bairro, cidade" },
  { key: "fiscalResponsibleCpf", label: "CPF do responsável perante a RFB", placeholder: "000.000.000-00" },
  { key: "fiscalUf", label: "UF", placeholder: "SP" },
];

/** Autocomplete da Tabela de Municípios (TOM) da RFB — preenche código + nome. */
function MunicipioAutocomplete({
  uf,
  code,
  name,
  onPick,
  onCodeChange,
}: {
  uf: string;
  code: string;
  name: string;
  onPick: (m: MunicipioHit) => void;
  onCodeChange: (code: string) => void;
}) {
  const [query, setQuery] = useState(name);
  const [hits, setHits] = useState<MunicipioHit[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => setQuery(name), [name]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q });
        if (uf) params.set("uf", uf);
        const res = await fetch(`/api/dimob/municipios?${params}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const j = await res.json();
        setHits(j.results ?? []);
      } catch {
        /* ignore (abortado ou rede) */
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, uf, open]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="space-y-1.5 sm:col-span-2">
      <Label htmlFor="fiscalMunicipio">Município (Receita/TOM)</Label>
      <div className="relative" ref={boxRef}>
        <Input
          id="fiscalMunicipio"
          value={query}
          placeholder="Digite o nome do município (ex.: São Paulo)"
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
        />
        {open && hits.length > 0 && (
          <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover shadow-md">
            {hits.map((m) => (
              <li key={`${m.tom}-${m.ibge}`}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    onPick(m);
                    setQuery(m.nome);
                    setOpen(false);
                  }}
                >
                  <span>
                    {m.nome} <span className="text-muted-foreground">/ {m.uf}</span>
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">TOM {m.tom}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Código TOM:</span>
        <Input
          aria-label="Código do município (TOM)"
          value={code}
          placeholder="7107"
          inputMode="numeric"
          className="h-8 w-28 font-mono text-sm"
          onChange={(e) => onCodeChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
        />
        <span className="text-xs text-muted-foreground">
          Selecione na lista para preencher automaticamente (4 dígitos da tabela da Receita).
        </span>
      </div>
    </div>
  );
}

export function FiscalSettingsForm({ initial }: { initial: FiscalSettings }) {
  const [form, setForm] = useState<FiscalSettings>(initial);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof FiscalSettings, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/org/fiscal-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...Object.fromEntries(FIELDS.map((f) => [f.key, (form[f.key] ?? "").toString().trim()])),
          fiscalMunicipioCode: (form.fiscalMunicipioCode ?? "").toString().trim(),
          fiscalMunicipioName: (form.fiscalMunicipioName ?? "").toString().trim(),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Falha ao salvar");
      }
      toast.success("Dados fiscais salvos.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Identificação do declarante</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={f.key}>{f.label}</Label>
              <Input
                id={f.key}
                value={(form[f.key] ?? "").toString()}
                placeholder={f.placeholder}
                onChange={(e) => set(f.key, e.target.value)}
              />
              {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
            </div>
          ))}
          <MunicipioAutocomplete
            uf={(form.fiscalUf ?? "").toString().trim().toUpperCase()}
            code={(form.fiscalMunicipioCode ?? "").toString()}
            name={(form.fiscalMunicipioName ?? "").toString()}
            onPick={(m) =>
              setForm((f) => ({
                ...f,
                fiscalMunicipioCode: m.tom,
                fiscalMunicipioName: m.nome,
                fiscalUf: f.fiscalUf?.trim() ? f.fiscalUf : m.uf,
              }))
            }
            onCodeChange={(code) => set("fiscalMunicipioCode", code)}
          />
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving ? "Salvando…" : "Salvar dados fiscais"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
