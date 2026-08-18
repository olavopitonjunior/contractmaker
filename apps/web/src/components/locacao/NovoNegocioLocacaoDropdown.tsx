"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NovoFormularioLocacaoDialog } from "@/components/locacao/NovoFormularioLocacaoDialog";
import { NovoContratoWizard } from "@/components/locacao/NovoContratoWizard";
import { NewDealFromProposalDialog } from "@/components/deals/NewDealFromProposalDialog";
import { FileText, ListChecks, Plus, Sparkles, Upload } from "lucide-react";

interface Option {
  id: string;
  label: string;
}

interface NovoNegocioLocacaoDropdownProps {
  properties: Option[];
  tenants: Option[];
}

/**
 * Dropdown "Novo negócio" do pipeline de locação — espelha o de vendas
 * (pipeline/page.tsx): form público, cadastro com proposta, cadastro rápido
 * com upload, e o wizard completo (Property/Tenant já cadastrados) como 4ª
 * opção. Os dois dialogs abrem controlados a partir dos itens do menu.
 */
export function NovoNegocioLocacaoDropdown({
  properties,
  tenants,
}: NovoNegocioLocacaoDropdownProps) {
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [proposalDialogOpen, setProposalDialogOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const wizardDisabled = properties.length === 0 || tenants.length === 0;

  // Vindo do onboarding (?novo=1): realça e abre o menu pra guiar o 1º negócio.
  const highlight = useSearchParams().get("novo") === "1";
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (highlight) {
      const t = setTimeout(() => setMenuOpen(true), 350);
      return () => clearTimeout(t);
    }
  }, [highlight]);

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            className={cn(
              highlight && !menuOpen && "ring-2 ring-brand-accent ring-offset-2 animate-pulse"
            )}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Novo negócio
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuItem
            className="flex items-start gap-3 py-2"
            onSelect={(e) => {
              // preventDefault: o close+restore-focus default do Radix fecha
              // o Dialog controlado aberto no mesmo tick.
              e.preventDefault();
              setFormDialogOpen(true);
            }}
          >
            <FileText className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">Novo formulário (link público)</span>
              <span className="text-xs text-muted-foreground">
                Envia link para locador/locatário preencherem. Contrato é gerado
                pelo template padrão.
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="flex items-start gap-3 py-2"
            onSelect={(e) => {
              e.preventDefault();
              setProposalDialogOpen(true);
            }}
          >
            <Sparkles className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">Cadastro com proposta</span>
              <span className="text-xs text-muted-foreground">
                Escolha uma proposta assinada do sistema ou anexe o PDF assinado
                de fora — o negócio nasce com os dados preenchidos.
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link
              href="/locacao/deals/new-from-upload"
              className="flex items-start gap-3 py-2"
            >
              <Upload className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">Cadastro rápido com upload</span>
                <span className="text-xs text-muted-foreground">
                  Sobe um contrato de locação pronto (PDF/DOCX). Sistema lê os
                  dados e abre o negócio com o contrato no editor.
                </span>
              </div>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="flex items-start gap-3 py-2"
            disabled={wizardDisabled}
            onSelect={(e) => {
              e.preventDefault();
              setWizardOpen(true);
            }}
          >
            <ListChecks className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">Cadastro completo (wizard)</span>
              <span className="text-xs text-muted-foreground">
                {wizardDisabled
                  ? "Cadastre imóvel e inquilino primeiro (Imóveis/Pessoas)."
                  : "Monta o contrato a partir de imóvel e inquilino já cadastrados, em 5 passos."}
              </span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <NovoFormularioLocacaoDialog
        open={formDialogOpen}
        onOpenChange={setFormDialogOpen}
      />
      <NewDealFromProposalDialog
        kind="locacao"
        open={proposalDialogOpen}
        onOpenChange={setProposalDialogOpen}
      />
      <NovoContratoWizard
        properties={properties}
        tenants={tenants}
        open={wizardOpen}
        onOpenChange={setWizardOpen}
      />
    </>
  );
}
