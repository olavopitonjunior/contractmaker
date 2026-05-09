"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";

interface OriginRow {
  campo: string;
  valor: string;
  origem: string;
}

const SOURCE_LABEL: Record<string, string> = {
  "ccv.comissionados": "contrato — lista explícita",
  "ccv.imobiliaria_principal": "contrato — corretora principal (legado)",
  manual: "adicionado manualmente",
};

/**
 * Drawer "De onde vieram esses valores?" — render puro a partir do estado
 * do wizard. Sem chamadas de API. UX: minimal, scaneável.
 */
export function DataOriginDrawer({
  open,
  onOpenChange,
  payerName,
  payerCpfCnpj,
  payerOrigem,
  valor,
  valorOrigem,
  vencimento,
  vencimentoReason,
  comissionados,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  payerName: string;
  payerCpfCnpj: string;
  payerOrigem: string;
  valor: string;
  valorOrigem: string;
  vencimento: string;
  vencimentoReason: string;
  comissionados: Array<{
    nome?: string;
    percentual?: number;
    source?: string;
    splitRecipientId?: string | null;
  }>;
}) {
  const rows: OriginRow[] = [
    { campo: "Pagador", valor: `${payerName} · ${payerCpfCnpj}`, origem: payerOrigem },
    { campo: "Valor", valor, origem: valorOrigem },
    { campo: "Vencimento", valor: vencimento, origem: vencimentoReason },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[500px]">
        <SheetHeader>
          <SheetTitle>De onde vieram esses valores?</SheetTitle>
          <SheetDescription>Origem auditável de cada campo pré-preenchido.</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {rows.map((r) => (
            <div key={r.campo} className="border-b pb-3">
              <div className="text-xs uppercase text-muted-foreground">{r.campo}</div>
              <div className="text-sm font-medium mt-0.5">{r.valor}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{r.origem}</div>
            </div>
          ))}

          {comissionados.length > 0 && (
            <div>
              <div className="text-xs uppercase text-muted-foreground mb-2">
                Comissionados ({comissionados.length})
              </div>
              <div className="space-y-2">
                {comissionados.map((c, i) => (
                  <div key={i} className="border rounded p-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span>{c.nome ?? "—"}</span>
                      <Badge variant="outline" className="text-xs">
                        {c.percentual ?? 0}%
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {SOURCE_LABEL[c.source ?? ""] ?? c.source ?? "?"}
                      {c.splitRecipientId ? " · destinatário cadastrado" : " · sem cadastro"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
