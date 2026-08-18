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
import { NewDealFromProposalDialog } from "@/components/deals/NewDealFromProposalDialog";
import { Building2, FileText, Plus, Sparkles, Upload } from "lucide-react";

/**
 * Dropdown "Novo negócio" do pipeline de vendas — extraído de pipeline/page.tsx
 * (server component) pra poder abrir o diálogo controlado do "Cadastro com
 * proposta" (proposta do sistema OU upload de PDF), espelhando o
 * NovoNegocioLocacaoDropdown.
 */
export function NovoNegocioDropdown({ hasIList }: { hasIList: boolean }) {
  const [proposalDialogOpen, setProposalDialogOpen] = useState(false);

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
          <DropdownMenuItem asChild>
            <Link href="/forms/new" className="flex items-start gap-3 py-2">
              <FileText className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">Novo formulário (link público)</span>
                <span className="text-xs text-muted-foreground">
                  Envia link para o cliente preencher os 7 passos. Contrato é
                  gerado pelo template padrão.
                </span>
              </div>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="flex items-start gap-3 py-2"
            onSelect={(e) => {
              // preventDefault: o close+restore-focus default do Radix fecha
              // o Dialog controlado aberto no mesmo tick.
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
            <Link href="/deals/new-from-upload" className="flex items-start gap-3 py-2">
              <Upload className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">Cadastro rápido com upload</span>
                <span className="text-xs text-muted-foreground">
                  Sobe um CCV (PDF/DOCX) pronto. Sistema lê os dados e abre o
                  contrato no editor pra revisar e enviar pra assinatura.
                </span>
              </div>
            </Link>
          </DropdownMenuItem>
          {hasIList && (
            <DropdownMenuItem asChild>
              <Link href="/deals/new-from-ilist" className="flex items-start gap-3 py-2">
                <Building2 className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">Novo contrato do iList</span>
                  <span className="text-xs text-muted-foreground">
                    Busca o imóvel no catálogo RE/MAX e abre o formulário com
                    imóvel e comissão pré-preenchidos.
                  </span>
                </div>
              </Link>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <NewDealFromProposalDialog
        kind="venda"
        open={proposalDialogOpen}
        onOpenChange={setProposalDialogOpen}
      />
    </>
  );
}
