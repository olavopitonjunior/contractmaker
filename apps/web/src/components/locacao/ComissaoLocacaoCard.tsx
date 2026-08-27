"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Handshake } from "lucide-react";
import {
  ComissaoLocacaoSection,
  type ComissaoLocacaoValue,
} from "@/components/locacao/ComissaoLocacaoSection";

interface ComissaoLocacaoCardProps {
  dealId: string;
  /** `dataJson.comissao` do form do deal. */
  initialValue: ComissaoLocacaoValue;
  /** `dataJson.aluguel.valor` — habilita os previews em R$. */
  valorAluguel?: number;
}

/**
 * Card editável da comissão na aba Dados do deal de locação. É a superfície do
 * OPERADOR: o resto da aba é read-only (edição das partes é pelo link público),
 * mas comissão nunca passa pelo cliente — ver ROLE_PATHS.
 *
 * Persiste em PATCH /api/locacao/deals/[dealId]/comissao (merge atômico
 * escopado em `comissao` + espelho no LeaseContract + auto-cadastro dos
 * angariadores no registry de corretores).
 */
export function ComissaoLocacaoCard({
  dealId,
  initialValue,
  valorAluguel = 0,
}: ComissaoLocacaoCardProps) {
  const router = useRouter();
  const [value, setValue] = useState<ComissaoLocacaoValue>(initialValue);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleChange = (next: ComissaoLocacaoValue) => {
    setValue(next);
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/locacao/deals/${dealId}/comissao`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Cherry-pick explícito (não `...value`): o schema da rota é o
          // contrato, e mandar o objeto inteiro deixaria passar chave nova sem
          // ninguém decidir. Por isso a forma/valor precisam entrar AQUI —
          // omiti-las fazia a comissão em valor fixo virar 0% ao salvar.
          forma_taxa_locacao: value.forma_taxa_locacao ?? "percentual",
          taxa_locacao_percent: value.taxa_locacao_percent ?? 0,
          taxa_locacao_valor: value.taxa_locacao_valor,
          angariadores: value.angariadores ?? [],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error ?? "Falha ao salvar a comissão.");
        return;
      }
      setDirty(false);
      toast.success("Comissão salva.");
      router.refresh();
    } catch {
      toast.error("Falha ao salvar a comissão.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Handshake className="h-4 w-4" /> Comissão e corretores
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ComissaoLocacaoSection
          value={value}
          onChange={handleChange}
          valorAluguel={valorAluguel}
          disabled={saving}
        />
        <div className="flex justify-end">
          <Button onClick={save} disabled={!dirty || saving} size="sm">
            {saving ? "Salvando..." : "Salvar comissão"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
