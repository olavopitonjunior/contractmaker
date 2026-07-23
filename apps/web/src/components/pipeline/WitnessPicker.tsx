"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, UsersRound, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WitnessScope } from "@/lib/clicksign/witness-scope";

export interface RegistryWitness {
  id: string;
  nome: string;
  cpf: string | null;
  email: string;
  mobilePhone: string | null;
  isDefault: boolean;
  scope: string;
}

interface WitnessPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Módulo cujo cadastro de testemunhas será listado. */
  scope: WitnessScope;
  /**
   * Chaves (e-mails lowercase e CPFs só-dígitos) já presentes no envelope. As
   * testemunhas do cadastro que casam são exibidas como "já adicionada" e não
   * podem ser selecionadas de novo (evita duplicidade/cobrança dobrada).
   */
  existingKeys?: string[];
  onConfirm: (selected: RegistryWitness[]) => void;
}

const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

/** Testemunha do cadastro normalizada pra virar linha de signatário. */
export interface PickedWitness {
  name: string;
  email: string;
  documentation: string;
  phone: string;
}

/**
 * Regra ÚNICA de dedupe + normalização das testemunhas escolhidas (antes cada
 * diálogo tinha sua cópia, com risco de divergir e admitir duplicata = cobrança
 * dobrada). Descarta as que colidem por e-mail (lowercase) ou CPF (dígitos) com
 * `existingKeys` OU entre si dentro da própria seleção. Cada diálogo mapeia o
 * resultado pro seu shape de linha e atribui o sourceIndex.
 */
export function pickNewWitnesses(
  selected: RegistryWitness[],
  existingKeys: string[]
): PickedWitness[] {
  const seen = new Set(existingKeys.map((k) => k.trim().toLowerCase()));
  const out: PickedWitness[] = [];
  for (const w of selected) {
    const email = (w.email ?? "").trim().toLowerCase();
    const cpf = digits(w.cpf);
    if ((email && seen.has(email)) || (cpf && seen.has(cpf))) continue;
    if (email) seen.add(email);
    if (cpf) seen.add(cpf);
    out.push({
      name: w.nome,
      email: w.email,
      documentation: cpf,
      phone: digits(w.mobilePhone),
    });
  }
  return out;
}

export function WitnessPicker({
  open,
  onOpenChange,
  scope,
  existingKeys = [],
  onConfirm,
}: WitnessPickerProps) {
  const [witnesses, setWitnesses] = useState<RegistryWitness[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const existing = new Set(existingKeys.map((k) => k.toLowerCase()));
  const isAlreadyAdded = (w: RegistryWitness) =>
    existing.has(w.email.toLowerCase()) ||
    (digits(w.cpf).length > 0 && existing.has(digits(w.cpf)));

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setSelected(new Set());
    (async () => {
      try {
        const res = await fetch(`/api/settings/witnesses?scope=${scope}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          toast.error(data.error || "Erro ao carregar testemunhas");
          setWitnesses([]);
          return;
        }
        const list: RegistryWitness[] = data.witnesses ?? [];
        setWitnesses(list);
        // Pré-marca as `isDefault` que ainda não estão no envelope.
        setSelected(
          new Set(
            list
              .filter((w) => w.isDefault && !isAlreadyAdded(w))
              .map((w) => w.id)
          )
        );
      } catch {
        if (!cancelled) toast.error("Erro de conexão");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleConfirm = () => {
    const chosen = witnesses.filter((w) => selected.has(w.id));
    onConfirm(chosen);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UsersRound className="h-4 w-4" />
            Selecionar testemunhas
          </DialogTitle>
          <DialogDescription>
            Escolha as testemunhas do cadastro para este envio. Você pode editar
            os dados depois, na lista de signatários.
          </DialogDescription>
        </DialogHeader>

        <div className="py-1 max-h-[50vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
            </div>
          ) : witnesses.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Nenhuma testemunha cadastrada para este módulo. Cadastre em
              Configurações › Assinaturas › Testemunhas.
            </p>
          ) : (
            <div className="divide-y">
              {witnesses.map((w) => {
                const added = isAlreadyAdded(w);
                const checked = selected.has(w.id);
                return (
                  <label
                    key={w.id}
                    className={cn(
                      "flex items-center gap-3 py-2.5 px-1 cursor-pointer",
                      added && "opacity-60 cursor-not-allowed"
                    )}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-input accent-primary shrink-0"
                      checked={added || checked}
                      disabled={added}
                      onChange={() => toggle(w.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">
                          {w.nome}
                        </span>
                        {w.isDefault && (
                          <Badge variant="secondary" className="text-[10px] h-5">
                            Padrão
                          </Badge>
                        )}
                        {added && (
                          <Badge variant="outline" className="text-[10px] h-5">
                            <UserCheck className="h-3 w-3 mr-1" />
                            Já adicionada
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {w.email}
                        {w.mobilePhone ? ` · ${w.mobilePhone}` : ""}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={selected.size === 0}>
            Adicionar {selected.size > 0 ? `(${selected.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
