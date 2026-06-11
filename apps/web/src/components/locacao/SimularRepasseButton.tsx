"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Eye } from "lucide-react";

interface Props {
  rentChargeIds: string[];
}

interface OwnerSplit {
  ownerId: string;
  nome: string;
  percentual: number;
  valorLiquido: number;
  irRetido: number;
}

interface Simulation {
  totalBruto: number;
  totalTaxaAdm: number;
  totalIrRetido: number;
  totalLiquidoProprietarios: number;
  porProprietario: OwnerSplit[];
}

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function SimularRepasseButton({ rentChargeIds }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sim, setSim] = useState<Simulation | null>(null);

  async function handleClick() {
    if (rentChargeIds.length === 0) return;
    setLoading(true);
    setOpen(true);
    try {
      const res = await fetch("/api/locacao/repasses/simular", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rentChargeIds }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as Simulation;
      setSim(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao simular");
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={handleClick} disabled={rentChargeIds.length === 0}>
        <Eye className="mr-1 h-3.5 w-3.5" />
        Simular
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Simulação de repasse</DialogTitle>
            <DialogDescription>
              Preview do cálculo {rentChargeIds.length} cobrança(s). Nenhum dado é gravado.
            </DialogDescription>
          </DialogHeader>
          {loading && <div className="py-6 text-center text-sm">Calculando…</div>}
          {sim && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-md bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground">Total bruto</div>
                  <div className="font-semibold">{fmtBRL(sim.totalBruto)}</div>
                </div>
                <div className="rounded-md bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground">Taxa adm imobiliária</div>
                  <div className="font-semibold">- {fmtBRL(sim.totalTaxaAdm)}</div>
                </div>
                <div className="rounded-md bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground">IR retido</div>
                  <div className="font-semibold">- {fmtBRL(sim.totalIrRetido)}</div>
                </div>
                <div className="rounded-md bg-primary/10 p-3">
                  <div className="text-xs text-primary">Líquido aos proprietários</div>
                  <div className="font-semibold text-primary">
                    {fmtBRL(sim.totalLiquidoProprietarios)}
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                  Por proprietário ({sim.porProprietario.length})
                </div>
                <ul className="divide-y rounded-md border">
                  {sim.porProprietario.map((p) => (
                    <li
                      key={p.ownerId}
                      className="flex items-center justify-between p-3 text-sm"
                    >
                      <div>
                        <div className="font-medium">{p.nome}</div>
                        <div className="text-xs text-muted-foreground">
                          {p.percentual}% da composição{" "}
                          {p.irRetido > 0 && `· IR ${fmtBRL(p.irRetido)}`}
                        </div>
                      </div>
                      <div className="font-semibold">{fmtBRL(p.valorLiquido)}</div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
