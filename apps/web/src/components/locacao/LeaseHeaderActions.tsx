"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDown, Printer, FileText, Settings2, FileCheck2 } from "lucide-react";

interface Props {
  leaseId: string;
  templates: Array<{ id: string; nome: string }>;
}

export function LeaseHeaderActions({ leaseId, templates }: Props) {
  const router = useRouter();
  const [renewOpen, setRenewOpen] = useState(false);
  const [terminateOpen, setTerminateOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [renewMonths, setRenewMonths] = useState("12");
  const [terminateReason, setTerminateReason] = useState("");
  const [checklistTemplateId, setChecklistTemplateId] = useState(templates[0]?.id ?? "");

  async function handleStatus(status: "renovacao" | "rescisao") {
    setSaving(true);
    try {
      const res = await fetch(`/api/locacao/leases/${leaseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          ...(status === "rescisao" ? { metadata: { reason: terminateReason } } : {}),
          ...(status === "renovacao" ? { metadata: { meses: Number(renewMonths) } } : {}),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      toast.success(status === "rescisao" ? "Rescisão iniciada" : "Renovação iniciada");
      setRenewOpen(false);
      setTerminateOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddChecklist() {
    setSaving(true);
    try {
      const templateRes = await fetch("/api/locacao/checklist-templates");
      const { templates: allTemplates } = (await templateRes.json()) as {
        templates: Array<{ id: string; nome: string; itensJson: unknown }>;
      };
      const template = allTemplates.find((t) => t.id === checklistTemplateId);
      if (!template) throw new Error("Template não encontrado");
      const itens = Array.isArray(template.itensJson)
        ? (template.itensJson as Array<{ titulo: string }>).map((i) => ({
            titulo: i.titulo,
            status: "pendente" as const,
          }))
        : [];
      const res = await fetch("/api/locacao/checklists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaseContractId: leaseId,
          templateId: template.id,
          nome: template.nome,
          itens,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      toast.success("Checklist adicionado");
      setChecklistOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="default" size="sm">
            <Settings2 className="mr-1 h-4 w-4" />
            Ações
            <ChevronDown className="ml-1 h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setChecklistOpen(true)}>
            <FileCheck2 className="mr-2 h-4 w-4" /> Adicionar checklist
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setRenewOpen(true)}>
            Renovar contrato
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setTerminateOpen(true)}
            className="text-destructive"
          >
            Rescindir contrato
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Printer className="mr-1 h-4 w-4" />
            Imprimir
            <ChevronDown className="ml-1 h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => toast.info("Espelho — em breve")}>
            Espelho do contrato
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => toast.info("Contrato em PDF — em breve")}>
            Contrato (PDF)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => toast.info("Recibo — em breve")}>
            Recibo
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button variant="outline" size="sm" onClick={() => toast.info("Pasta do contrato — em breve")}>
        <FileText className="mr-1 h-4 w-4" />
        Documentos
      </Button>

      <Dialog open={renewOpen} onOpenChange={setRenewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renovar contrato</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label>Prazo de renovação (meses)</Label>
            <Input
              type="number"
              min={1}
              max={60}
              value={renewMonths}
              onChange={(e) => setRenewMonths(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Vai marcar o contrato como <strong>renovação</strong> e abrir o fluxo de
              reajuste/aditivo. Renovação efetiva precisa do aditivo assinado.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenewOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={() => handleStatus("renovacao")} disabled={saving}>
              {saving ? "..." : "Renovar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={terminateOpen} onOpenChange={setTerminateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rescindir contrato</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label>Motivo</Label>
            <Input
              placeholder="ex.: desistência do inquilino, ação judicial..."
              value={terminateReason}
              onChange={(e) => setTerminateReason(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Marca <strong>rescisao</strong>. Multa proporcional (art. 4 Lei 8.245) deve ser
              calculada e lançada como Expense separadamente.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTerminateOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleStatus("rescisao")}
              disabled={saving || !terminateReason}
            >
              {saving ? "..." : "Rescindir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={checklistOpen} onOpenChange={setChecklistOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar checklist</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label>Modelo</Label>
            <Select value={checklistTemplateId} onValueChange={setChecklistTemplateId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Instancia o modelo no contrato. Itens podem ser marcados na seção Checklists.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChecklistOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleAddChecklist} disabled={saving || !checklistTemplateId}>
              {saving ? "..." : "Adicionar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
