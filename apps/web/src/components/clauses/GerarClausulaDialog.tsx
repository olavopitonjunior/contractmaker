"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CLAUSE_SUBCATEGORY_SUGGESTIONS } from "@/lib/clauses/schema";

interface SimilarClause {
  id: string;
  title: string;
  similarity: number;
}

interface GerarClausulaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Usuário escolheu uma cláusula parecida em vez de gerar — abre o detail dela. */
  onUseExisting: (clauseId: string) => void;
}

/**
 * Dialog "Gerar com IA" — POST /api/clauses/ai-generate. Antes de gerar às
 * cegas, o endpoint checa o acervo: cláusula muito parecida (>=75%) volta
 * `{similar}` SEM gerar, e esta UI decide entre reaproveitar a existente ou
 * insistir com `force:true`. Sem duplicata, a cláusula sai criada como
 * `pending` — o texto ainda precisa de revisão humana.
 */
export function GerarClausulaDialog({
  open,
  onOpenChange,
  onUseExisting,
}: GerarClausulaDialogProps) {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("customizada");
  const [loading, setLoading] = useState(false);
  const [similar, setSimilar] = useState<SimilarClause[] | null>(null);

  function reset() {
    setDescription("");
    setCategory("customizada");
    setSimilar(null);
    setLoading(false);
  }

  function handleOpenChange(v: boolean) {
    if (!v) reset();
    onOpenChange(v);
  }

  async function generate(force: boolean) {
    if (!description.trim()) {
      toast.error("Descreva a cláusula que você quer gerar.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/clauses/ai-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: description.trim(), category, force }),
      });
      // res.json() pode resolver null (body null passa pelo catch) — o acesso
      // direto estourava TypeError e mostrava "erro de conexão" falso.
      const data = ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>;
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : "Falha ao gerar cláusula");
        return;
      }
      if (Array.isArray(data.similar)) {
        setSimilar(data.similar as SimilarClause[]);
        return;
      }
      toast.success("Cláusula gerada como pendente — revise antes de aprovar.");
      handleOpenChange(false);
      router.refresh();
    } catch {
      toast.error("Erro de conexão ao gerar cláusula.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Gerar cláusula com IA</DialogTitle>
          <DialogDescription>
            Descreva a situação — o agente redige em Handlebars e a cláusula entra
            pendente de revisão.
          </DialogDescription>
        </DialogHeader>

        {similar ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              O acervo já tem cláusulas parecidas. Use uma existente ou gere mesmo
              assim.
            </p>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {similar.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-2 rounded-md border p-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{s.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {Math.round(s.similarity * 100)}% de similaridade
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      onUseExisting(s.id);
                      handleOpenChange(false);
                    }}
                  >
                    Usar existente
                  </Button>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setSimilar(null)}>
                Voltar
              </Button>
              <Button type="button" disabled={loading} onClick={() => generate(true)}>
                {loading ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-1 h-4 w-4" />
                )}
                Gerar mesmo assim
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Descrição</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ex: cláusula de multa por atraso na entrega das chaves"
                  className="min-h-[100px] text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLAUSE_SUBCATEGORY_SUGGESTIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="button" disabled={loading} onClick={() => generate(false)}>
                {loading ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-1 h-4 w-4" />
                )}
                {loading ? "Gerando..." : "Gerar"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
