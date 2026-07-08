"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ContractEditorPage } from "@/components/contracts/ContractEditorPage";
import { LeaseSignaturesTab } from "@/components/locacao/LeaseSignaturesTab";
import type { LeaseSignerData } from "@/components/locacao/SendLeaseEnvelopeDialog";
import { Building2, FileSignature, Loader2 } from "lucide-react";

type ContractProp = React.ComponentProps<typeof ContractEditorPage>["contract"];
type VersionsProp = React.ComponentProps<typeof ContractEditorPage>["versions"];

interface LocacaoAdminContractTabProps {
  dealId: string;
  /** Contrato de administração (kind="administracao") latest, ou null. */
  adminContract: ContractProp | null;
  adminVersions: VersionsProp;
  /** Partes p/ popup de assinatura — proprietários (locadores) + imobiliária. */
  signerData: LeaseSignerData;
  /** Nome da org (administradora) pra pré-preencher a linha da imobiliária. */
  imobiliariaNome?: string;
}

/**
 * Aba "Administração" do deal de locação: gera, edita, aprova e assina o
 * CONTRATO DE ADMINISTRAÇÃO DE LOCAÇÃO (imobiliária ↔ proprietário). Espelha a
 * aba Contrato + Assinaturas, mas escopada ao instrumento kind="administracao".
 *
 * Empty state → CTA "Gerar contrato de administração" (POST admin-contract).
 * Com contrato → editor Google Docs (agente IA de locação, já é dealKind-aware)
 * + assinaturas via `LeaseSignaturesTab variant="administracao"`.
 */
export function LocacaoAdminContractTab({
  dealId,
  adminContract,
  adminVersions,
  signerData,
  imobiliariaNome,
}: LocacaoAdminContractTabProps) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);

  const gerar = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/locacao/deals/${dealId}/admin-contract`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success("Contrato de administração gerado.");
        router.refresh();
      } else {
        toast.error(
          body.error ||
            "Falha ao gerar. Verifique se há um template de administração ativo (sync-templates --apply --seed)."
        );
      }
    } catch {
      toast.error("Falha ao gerar o contrato de administração.");
    } finally {
      setGenerating(false);
    }
  };

  if (!adminContract) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <Building2 className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">
            Contrato de administração não gerado
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            O contrato de administração formaliza a relação entre a imobiliária e
            o(s) proprietário(s): taxa de administração, poderes de gestão,
            repasse e prestação de contas. Pode ser gerado a qualquer momento.
          </p>
          <Button onClick={gerar} disabled={generating} className="mt-4">
            {generating ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <FileSignature className="mr-1.5 h-4 w-4" />
            )}
            Gerar contrato de administração
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <ContractEditorPage contract={adminContract} versions={adminVersions} />
      <Separator />
      <LeaseSignaturesTab
        contractId={adminContract.id}
        contractStatus={adminContract.status}
        data={signerData}
        variant="administracao"
        imobiliaria={{ nome: imobiliariaNome }}
      />
    </div>
  );
}
