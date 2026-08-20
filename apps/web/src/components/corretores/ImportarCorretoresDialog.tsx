"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { isValidCpfCnpj } from "@/lib/validators/corretor";
import { normalizeBrPhone } from "@/lib/validators/phone-br";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";

interface UncadastradoItem {
  cpfCnpj: string;
  nome: string;
  cpf?: string;
  cnpj?: string;
  email?: string;
  mobile_phone?: string;
  seenInDeals: string[];
}

interface ImportarCorretoresDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

function maskDoc(doc: string): string {
  if (doc.length < 6) return doc;
  return `${doc.slice(0, 3)}***${doc.slice(-2)}`;
}

/**
 * "Importar dos contratos" — GET .../uncadastrados lista corretores citados
 * em contratos dos últimos 90 dias sem SplitRecipient. Criar via POST em lote
 * (um request por item, cada um pode falhar independentemente) com o mesmo
 * payload de rascunho do cadastro manual (CorretorFormSheet): sem meio de
 * recebimento, pendingFields:["walletId"].
 */
export function ImportarCorretoresDialog({
  open,
  onOpenChange,
  onImported,
}: ImportarCorretoresDialogProps) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<UncadastradoItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  async function loadItems() {
    setLoading(true);
    try {
      const res = await fetch("/api/financeiro/split-recipients/uncadastrados", {
        credentials: "include",
      });
      const data = res.ok ? await res.json() : { items: [] };
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch {
      toast.error("Falha ao carregar corretores dos contratos");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    void loadItems();
  }, [open]);

  function toggle(doc: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(doc)) next.delete(doc);
      else next.add(doc);
      return next;
    });
  }

  // Doc com DV inválido não é selecionável: o POST estrito devolveria 422 e,
  // como o dedupe do endpoint é por documento, o item voltaria pra lista a
  // cada tentativa — loop sem saída. Melhor mostrar o motivo e apontar o
  // caminho (cadastro manual com o doc corrigido).
  const importable = items.filter((i) => isValidCpfCnpj(i.cpfCnpj));

  function toggleAll() {
    setSelected((prev) =>
      prev.size === importable.length
        ? new Set()
        : new Set(importable.map((i) => i.cpfCnpj))
    );
  }

  async function handleImport() {
    const chosen = items.filter((i) => selected.has(i.cpfCnpj));
    if (chosen.length === 0) return;
    setImporting(true);
    let created = 0;
    const errors: string[] = [];
    try {
      for (const item of chosen) {
        const tipoPessoa = item.cpfCnpj.length === 14 ? "juridica" : "fisica";
        // Dados raspados de dataJson são sujos por natureza (form público grava
        // soft): saneia ANTES do POST estrito — telefone sem DDD ou doc com DV
        // errado deixaria o item 422 pra sempre. O que não passa é OMITIDO (o
        // cadastro nasce sem o campo; o admin corrige na tela).
        const phone = item.mobile_phone ? normalizeBrPhone(item.mobile_phone) : null;
        const email =
          item.email && /.+@.+\..+/.test(item.email) ? item.email.trim().toLowerCase() : null;
        const payload = {
          kind: "commissioner",
          recipientType: "asaas_wallet",
          label: item.nome,
          cpfCnpj: item.cpfCnpj,
          tipoPessoa,
          email,
          phone,
          // Sem meio de recebimento: rascunho — mesmo padrão do cadastro
          // manual (CorretorFormSheet), completável depois via "Pedir dados".
          pendingFields: ["walletId"],
        };
        const res = await fetch("/api/financeiro/split-recipients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          created += 1;
        } else {
          const data = await res.json().catch(() => ({}));
          errors.push(`${item.nome}: ${data.error ?? "falha desconhecida"}`);
        }
      }
    } finally {
      setImporting(false);
    }

    if (created > 0) {
      toast.success(
        `${created} corretor${created === 1 ? "" : "es"} cadastrado${created === 1 ? "" : "s"}`
      );
      onImported();
    }
    if (errors.length > 0) {
      toast.error(
        errors.length === 1
          ? errors[0]
          : `${errors.length} falharam ao importar: ${errors[0]}`
      );
    }

    if (errors.length === 0) {
      onOpenChange(false);
      return;
    }
    // Sobrou erro: recarrega a lista (os importados com sucesso já saem —
    // não têm mais SplitRecipient faltando) e limpa a seleção.
    setSelected(new Set());
    void loadItems();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Importar corretores dos contratos</DialogTitle>
          <DialogDescription>
            Corretores citados em contratos dos últimos 90 dias que ainda não
            têm cadastro. Selecione quem quer cadastrar — o meio de
            recebimento fica pendente e pode ser completado depois.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Carregando...</p>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhum corretor pendente de cadastro encontrado nos contratos recentes.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b pb-2">
              <Checkbox
                id="import-all"
                checked={importable.length > 0 && selected.size === importable.length}
                onCheckedChange={toggleAll}
              />
              <label htmlFor="import-all" className="cursor-pointer text-xs text-muted-foreground">
                Selecionar todos ({importable.length})
              </label>
            </div>
            <ScrollArea className="max-h-72">
              <div className="space-y-1 pr-3">
                {items.map((item) => {
                  const docOk = isValidCpfCnpj(item.cpfCnpj);
                  return (
                    <label
                      key={item.cpfCnpj}
                      className={
                        docOk
                          ? "flex items-start gap-2 rounded-md p-2 text-sm hover:bg-accent cursor-pointer"
                          : "flex items-start gap-2 rounded-md p-2 text-sm opacity-60"
                      }
                    >
                      <Checkbox
                        checked={selected.has(item.cpfCnpj)}
                        onCheckedChange={() => toggle(item.cpfCnpj)}
                        disabled={!docOk}
                        className="mt-0.5"
                      />
                      <div className="min-w-0">
                        <div className="font-medium">{item.nome}</div>
                        <div className="text-xs text-muted-foreground">
                          {maskDoc(item.cpfCnpj)}
                          {item.email ? ` · ${item.email}` : ""}
                          {item.seenInDeals.length > 0
                            ? ` · ${item.seenInDeals.length} negócio${item.seenInDeals.length === 1 ? "" : "s"}`
                            : ""}
                          {!docOk &&
                            " · CPF/CNPJ inválido no contrato — cadastre manualmente com o documento corrigido"}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </ScrollArea>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button onClick={handleImport} disabled={selected.size === 0 || importing}>
            {importing ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-1" />
            )}
            Cadastrar selecionados{selected.size > 0 ? ` (${selected.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
