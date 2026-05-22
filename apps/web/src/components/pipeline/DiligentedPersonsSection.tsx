"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, ChevronDown, ChevronRight, Users } from "lucide-react";
import { DiligentedPersonDialog } from "./DiligentedPersonDialog";
import { toast } from "sonner";

export interface DiligentedPersonRow {
  id: string;
  tipoPessoa: string;
  nome: string;
  cpf: string | null;
  cnpj: string | null;
  dataNascimento: string | null;
  uf: string | null;
  cidade: string | null;
  relacao: string | null;
  notes: string | null;
  createdAt: string;
}

interface Props {
  dealId: string;
  /**
   * B1 — partes cadastradas do negócio (vendedores/compradores/imóvel) que são
   * consultadas. Exibidas como roster read-only no topo da seção, junto das
   * pessoas adicionadas manualmente abaixo.
   */
  parties?: Array<{ kind: string; label: string; sub?: string }>;
  onChange?: () => void;
}

const KIND_LABEL: Record<string, string> = {
  vendedor: "Vendedor",
  comprador: "Comprador",
  imovel: "Imóvel",
};

const RELACAO_LABELS: Record<string, string> = {
  socio: "Sócio",
  avalista: "Avalista",
  procurador: "Procurador",
  conjuge: "Cônjuge",
  outro: "Outro",
};

function formatDoc(p: DiligentedPersonRow): string {
  if (p.tipoPessoa === "fisica" && p.cpf) {
    return `CPF ${p.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")}`;
  }
  if (p.tipoPessoa === "juridica" && p.cnpj) {
    return `CNPJ ${p.cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5")}`;
  }
  return "—";
}

export function DiligentedPersonsSection({ dealId, parties = [], onChange }: Props) {
  const [items, setItems] = useState<DiligentedPersonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/diligenciados`);
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.items ?? []);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreated = () => {
    load();
    onChange?.();
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/deals/${dealId}/diligenciados/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Erro ao remover");
        return;
      }
      toast.success("Pessoa removida");
      load();
      onChange?.();
    } finally {
      setDeletingId(null);
    }
  };

  if (loading && items.length === 0 && parties.length === 0) return null;

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-2 text-sm font-semibold hover:text-primary"
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <Users className="h-4 w-4" />
              Pessoas diligenciadas
              {items.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {items.length}
                </Badge>
              )}
            </button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDialogOpen(true)}
            >
              <Plus className="h-3 w-3 mr-1" />
              Adicionar
            </Button>
          </div>
        </CardHeader>
        {expanded && (parties.length > 0 || items.length > 0) && (
          <CardContent className="space-y-2 pt-0">
            {parties.length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  Partes do negócio (consultadas)
                </p>
                {parties.map((p, i) => (
                  <div
                    key={`${p.kind}-${i}`}
                    className="flex items-center gap-2 rounded border bg-muted/20 p-2 text-sm"
                  >
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      {KIND_LABEL[p.kind] ?? p.kind}
                    </Badge>
                    <span className="font-medium truncate flex-1">{p.label}</span>
                    {p.sub && (
                      <span className="text-xs text-muted-foreground truncate">
                        {p.sub}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {items.length > 0 && parties.length > 0 && (
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide pt-1">
                Adicionadas
              </p>
            )}
            {items.map((p) => (
              <div
                key={p.id}
                className="flex items-start justify-between gap-2 rounded border p-2 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{p.nome}</span>
                    {p.relacao && (
                      <Badge variant="outline" className="text-[10px]">
                        {RELACAO_LABELS[p.relacao] ?? p.relacao}
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-[10px]">
                      {p.tipoPessoa === "fisica" ? "PF" : "PJ"}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground flex gap-2 flex-wrap mt-0.5">
                    <span>{formatDoc(p)}</span>
                    {p.uf && <span>{p.uf}</span>}
                    {p.cidade && <span>{p.cidade}</span>}
                    {p.dataNascimento && <span>Nasc: {p.dataNascimento}</span>}
                  </div>
                  {p.notes && (
                    <p className="text-xs text-muted-foreground mt-0.5 italic">
                      {p.notes}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-destructive hover:bg-destructive/10"
                  onClick={() => handleDelete(p.id)}
                  disabled={deletingId === p.id}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </CardContent>
        )}
        {expanded && items.length === 0 && parties.length === 0 && (
          <CardContent className="pt-0 pb-3">
            <p className="text-xs text-muted-foreground">
              Use esta seção para adicionar pessoas externas ao contrato
              (sócios de PJ, avalistas, procuradores) cujas certidões devem
              ser extraídas para due diligence.
            </p>
          </CardContent>
        )}
      </Card>

      <DiligentedPersonDialog
        dealId={dealId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={handleCreated}
      />
    </>
  );
}
