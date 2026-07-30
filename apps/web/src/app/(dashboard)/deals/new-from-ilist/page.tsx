"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Building2, Search } from "lucide-react";
import {
  IListPickerDialog,
  type IListImportPayload,
  type IListListingItem,
} from "@/components/ilist/IListPickerDialog";
import { ManagerSelect } from "@/components/deals/ManagerSelect";

/**
 * Novo negócio de venda a partir do catálogo iList (RE/MAX): escolhe o imóvel
 * no picker → cria Deal + SalesForm pré-preenchido (imóvel + comissão do
 * listing) → abre `/f/[token]?prefilled=1` pro corretor completar as partes.
 */
export default function NewDealFromIListPage() {
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<IListListingItem | null>(null);
  // Gerente responsável pelo negócio (obrigatório quando a org liga o toggle).
  const [managerUserId, setManagerUserId] = useState<string | null>(null);
  const [managerRequired, setManagerRequired] = useState(false);

  /** Gate client do gerente — evita abrir o picker só pra tomar 422 no fim. */
  function missingManager() {
    if (managerRequired && !managerUserId) {
      toast.error("Selecione o gerente responsável");
      return true;
    }
    return false;
  }

  async function handleSelect(_payload: IListImportPayload, item: IListListingItem) {
    if (missingManager()) return;
    setSelected(item);
    setCreating(true);
    try {
      const res = await fetch("/api/deals/new-from-ilist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingRowId: item.id,
          ...(managerUserId ? { managerUserId } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Fallback do gate server-side (org exige gerente e o client não sabia).
        if (res.status === 422 && data?.error === "gerente_obrigatorio") {
          setManagerRequired(true);
          throw new Error(data.message ?? "Selecione o gerente responsável");
        }
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      toast.success("Imóvel importado. Complete as partes no formulário.");
      router.push(`${data.formUrl ?? `/f/${data.formToken}`}?prefilled=1`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao criar o negócio");
      setCreating(false);
      setSelected(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <Link
        href="/pipeline"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> Pipeline
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Novo contrato a partir do iList
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Busque o imóvel no catálogo RE/MAX da sua imobiliária. O formulário do contrato
            nasce com o imóvel e a comissão do listing pré-preenchidos — você completa
            vendedores, compradores e pagamento em seguida.
          </p>

          <ManagerSelect
            value={managerUserId}
            onChange={setManagerUserId}
            disabled={creating}
            onContextLoaded={(ctx) => setManagerRequired(ctx.managerRequired)}
          />

          {creating && selected ? (
            <div className="rounded-lg border p-4 text-sm">
              Criando negócio para{" "}
              <span className="font-medium">
                {selected.listingCode ? `#${selected.listingCode} — ` : ""}
                {selected.endereco ?? "imóvel selecionado"}
              </span>
              …
            </div>
          ) : (
            <Button
              onClick={() => {
                if (missingManager()) return;
                setPickerOpen(true);
              }}
            >
              <Search className="mr-1 h-4 w-4" />
              Buscar imóvel no iList
            </Button>
          )}
        </CardContent>
      </Card>

      <IListPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        transactionType="venda"
        onSelect={handleSelect}
      />
    </div>
  );
}
