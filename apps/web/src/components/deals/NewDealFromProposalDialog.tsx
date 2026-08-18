"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { FileSignature, Loader2, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ManagerSelect } from "@/components/deals/ManagerSelect";
import { ProposalUploadForm } from "@/components/deals/ProposalUploadForm";
import { usePermissions } from "@/hooks/usePermissions";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { NO_PERMISSION_HINT } from "@/lib/security/rbac/ui";
import { useConvertProposal } from "@/lib/proposals/use-convert-proposal";

interface EligibleProposal {
  id: string;
  title: string;
  kind: string;
  proponente: string | null;
  imovel: string | null;
  valorLabel: string | null;
  completedAtLabel: string;
  dossierReady: boolean;
}

/**
 * Pop do "Cadastro com proposta" (dropdown Novo negócio) com as DUAS vias:
 *  - proposta assinada AQUI DENTRO → picker + conversão existente (o negócio
 *    nasce com formulário preenchido e documentos copiados, e a proposta fica
 *    vinculada);
 *  - proposta assinada POR FORA → upload do PDF com extração via IA (fluxo que
 *    era a página inteira; ela continua existindo pra deep-link).
 */
export function NewDealFromProposalDialog({
  kind,
  open,
  onOpenChange,
}: {
  kind: "venda" | "locacao";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const perms = usePermissions();
  const canConvert = perms.loading || perms.can(PERMISSION.PROPOSAL_CONVERT);
  const { convert, busy } = useConvertProposal();

  const [loading, setLoading] = useState(false);
  const [proposals, setProposals] = useState<EligibleProposal[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [managerUserId, setManagerUserId] = useState<string | null>(null);
  const [managerRequired, setManagerRequired] = useState(false);

  const fetchEligible = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/proposals?eligible=convert&kind=${kind}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      setProposals(d.proposals ?? []);
    } catch {
      toast.error("Não foi possível carregar as propostas assinadas.");
      setProposals([]);
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    if (open) void fetchEligible();
    else {
      setSelectedId(null);
      setManagerRequired(false);
    }
  }, [open, fetchEligible]);

  const selected = proposals?.find((p) => p.id === selectedId) ?? null;

  function handleConvert() {
    if (!selected) return;
    void convert({
      proposalId: selected.id,
      kind,
      managerUserId,
      onManagerRequired: () => setManagerRequired(true),
      onAlreadyConverted: () => void fetchEligible(),
      onSuccess: () => onOpenChange(false),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cadastro com proposta</DialogTitle>
          <DialogDescription>
            Proposta assinada aqui no sistema? O negócio nasce com formulário
            preenchido e documentos copiados. Assinada por fora? Anexe o PDF e a
            IA extrai os dados.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="sistema">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="sistema">
              <FileSignature className="mr-1.5 h-4 w-4" /> Proposta do sistema
            </TabsTrigger>
            <TabsTrigger value="upload">
              <Upload className="mr-1.5 h-4 w-4" /> Anexar PDF de fora
            </TabsTrigger>
          </TabsList>

          <TabsContent value="sistema" className="space-y-3 pt-2">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando propostas
                assinadas…
              </div>
            ) : !proposals || proposals.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                <p>Nenhuma proposta assinada aguardando conversão.</p>
                <p className="mt-1">
                  Propostas assinadas dentro do sistema aparecem aqui — veja a{" "}
                  <Link
                    href={`/pipeline/propostas?tipo=${kind}`}
                    className="underline"
                  >
                    lista de propostas
                  </Link>
                  .
                </p>
              </div>
            ) : (
              <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                {proposals.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    className={`w-full rounded-md border p-2.5 text-left text-sm transition-colors ${
                      selectedId === p.id
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{p.title}</span>
                      {!p.dossierReady && (
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                          processando documento
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {[p.proponente, p.imovel, p.valorLabel]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      assinada em {p.completedAtLabel}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {selected && !selected.dossierReady && (
              <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
                O documento assinado desta proposta ainda está sendo processado.
                Se a conversão falhar, aguarde alguns instantes e tente de novo.
              </p>
            )}

            {managerRequired && (
              <ManagerSelect
                value={managerUserId}
                onChange={setManagerUserId}
                disabled={busy}
                onContextLoaded={(ctx) => setManagerRequired(ctx.managerRequired)}
              />
            )}

            <Button
              className="w-full"
              disabled={
                !selected ||
                busy ||
                !canConvert ||
                (managerRequired && !managerUserId)
              }
              title={!canConvert ? NO_PERMISSION_HINT : undefined}
              onClick={handleConvert}
            >
              {busy ? "Convertendo…" : "Converter em negócio"}
            </Button>
          </TabsContent>

          <TabsContent value="upload" className="pt-2">
            <ProposalUploadForm kind={kind} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
