"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import {
  LAUDO_ESTADOS,
  LAUDO_ESTADO_LABELS,
  type LaudoAmbiente,
  type LaudoItem,
} from "@/lib/locacao/inspection-types";
import { FotoUploader } from "./FotoUploader";

interface Props {
  inspectionId: string;
  ambiente: LaudoAmbiente;
  onChange: (ambiente: LaudoAmbiente) => void;
  onRemove: () => void;
  disabled?: boolean;
}

const ITENS_SUGERIDOS = ["Piso", "Paredes", "Teto", "Janelas", "Portas", "Tomadas", "Iluminação"];

function novoItem(nome: string): LaudoItem {
  return { id: crypto.randomUUID(), nome, estado: "bom", fotos: [] };
}

export function AmbienteCard({ inspectionId, ambiente, onChange, onRemove, disabled }: Props) {
  const [open, setOpen] = useState(true);
  const [novoNome, setNovoNome] = useState("");

  function setItem(idx: number, item: LaudoItem) {
    const itens = ambiente.itens.slice();
    itens[idx] = item;
    onChange({ ...ambiente, itens });
  }

  function addItem(nome: string) {
    const n = nome.trim();
    if (!n) return;
    onChange({ ...ambiente, itens: [...ambiente.itens, novoItem(n)] });
    setNovoNome("");
  }

  const sugestoesRestantes = ITENS_SUGERIDOS.filter(
    (s) => !ambiente.itens.some((i) => i.nome.toLowerCase() === s.toLowerCase())
  );

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="flex items-center gap-2 text-left font-medium"
            onClick={() => setOpen(!open)}
          >
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {ambiente.nome}
            <span className="text-xs font-normal text-muted-foreground">
              {ambiente.itens.length} item(ns) · {ambiente.fotos.length} foto(s)
            </span>
          </button>
          {!disabled && (
            <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {open && (
          <div className="space-y-4">
            <div className="space-y-2">
              {ambiente.itens.map((item, idx) => (
                <div key={item.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-[120px] flex-1 text-sm font-medium">{item.nome}</span>
                    <Select
                      value={item.estado}
                      onValueChange={(v) =>
                        setItem(idx, { ...item, estado: v as LaudoItem["estado"] })
                      }
                      disabled={disabled}
                    >
                      <SelectTrigger className="h-8 w-[110px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LAUDO_ESTADOS.map((e) => (
                          <SelectItem key={e} value={e}>
                            {LAUDO_ESTADO_LABELS[e]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!disabled && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          onChange({
                            ...ambiente,
                            itens: ambiente.itens.filter((i) => i.id !== item.id),
                          })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  <Textarea
                    placeholder="Observações do item (riscos, manchas, danos…)"
                    className="mt-2 min-h-[40px] text-sm"
                    value={item.observacoes ?? ""}
                    disabled={disabled}
                    onChange={(e) =>
                      setItem(idx, { ...item, observacoes: e.target.value || undefined })
                    }
                  />
                  <div className="mt-2">
                    <FotoUploader
                      inspectionId={inspectionId}
                      fotos={item.fotos}
                      disabled={disabled}
                      onChange={(fotos) => setItem(idx, { ...item, fotos })}
                    />
                  </div>
                </div>
              ))}
            </div>

            {!disabled && (
              <div className="space-y-2">
                {sugestoesRestantes.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {sugestoesRestantes.map((s) => (
                      <Button
                        key={s}
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => addItem(s)}
                      >
                        <Plus className="mr-1 h-3 w-3" /> {s}
                      </Button>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    placeholder="Outro item (ex.: Ar-condicionado)"
                    className="h-8 text-sm"
                    value={novoNome}
                    onChange={(e) => setNovoNome(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addItem(novoNome);
                      }
                    }}
                  />
                  <Button type="button" size="sm" variant="outline" onClick={() => addItem(novoNome)}>
                    Adicionar
                  </Button>
                </div>
              </div>
            )}

            <div>
              <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                Observações e fotos gerais do ambiente
              </p>
              <Textarea
                placeholder="Observações do ambiente"
                className="min-h-[40px] text-sm"
                value={ambiente.observacoes ?? ""}
                disabled={disabled}
                onChange={(e) =>
                  onChange({ ...ambiente, observacoes: e.target.value || undefined })
                }
              />
              <div className="mt-2">
                <FotoUploader
                  inspectionId={inspectionId}
                  fotos={ambiente.fotos}
                  disabled={disabled}
                  onChange={(fotos) => onChange({ ...ambiente, fotos })}
                />
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
