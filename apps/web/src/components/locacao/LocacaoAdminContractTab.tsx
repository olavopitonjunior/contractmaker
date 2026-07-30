"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ContractEditorPage } from "@/components/contracts/ContractEditorPage";
import type { LocacaoSettings } from "@/lib/contracts/default-config";
import { LeaseSignaturesTab } from "@/components/locacao/LeaseSignaturesTab";
import type { LeaseSignerData } from "@/components/locacao/SendLeaseEnvelopeDialog";
import {
  DadosAdministracaoDialog,
  type DadosAdministracaoValue,
} from "@/components/locacao/DadosAdministracaoDialog";
import { Building2, FileSignature, Loader2, RefreshCw } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { NO_PERMISSION_HINT } from "@/lib/security/rbac/ui";

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
  /** Padrão contratual de LOCAÇÃO da org — o instrumento de administração usa o
   *  mesmo vocabulário (comarca, multas do aluguel), não o de venda. */
  orgDefaults?: LocacaoSettings;
  /** `fiscal` do dataJson — pré-preenche o diálogo de dados da administração. */
  fiscal?: DadosAdministracaoValue;
}

/**
 * Aba "Administração" do deal de locação: gera, edita, aprova e assina o
 * CONTRATO DE ADMINISTRAÇÃO DE LOCAÇÃO (imobiliária ↔ proprietário). Espelha a
 * aba Contrato + Assinaturas, mas escopada ao instrumento kind="administracao".
 *
 * Empty state → CTA "Gerar contrato de administração", que abre antes o
 * diálogo de dados da administração (taxa/IR/cobrança/NFS-e, PATCH .../fiscal)
 * e só então dispara o POST admin-contract. Com contrato → editor Google Docs
 * (agente IA de locação, já é dealKind-aware) + assinaturas via
 * `LeaseSignaturesTab variant="administracao"`, e o botão de regerar reabre o
 * mesmo diálogo pré-preenchido.
 */
export function LocacaoAdminContractTab({
  dealId,
  adminContract,
  adminVersions,
  signerData,
  imobiliariaNome,
  orgDefaults,
  fiscal,
}: LocacaoAdminContractTabProps) {
  const router = useRouter();
  const perms = usePermissions();
  // Gating de CTA (feature Gerente) — libera enquanto carrega pra não piscar.
  const canCreateContract =
    perms.loading || perms.can(PERMISSION.CONTRACT_CREATE);
  const [generating, setGenerating] = useState(false);
  const [dadosOpen, setDadosOpen] = useState(false);
  // Âncora da seção de assinatura — o CTA do banner de aprovado do editor rola
  // até aqui (senão o CTA default do ContractEditorPage levaria à tela de
  // VENDAS `/deals/[id]`, fora do fluxo de administração).
  const signRef = useRef<HTMLDivElement>(null);

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
            "Falha ao gerar. Ative ou envie um modelo de administração em Configurações → Modelos."
        );
      }
    } catch {
      toast.error("Falha ao gerar o contrato de administração.");
    } finally {
      setGenerating(false);
    }
  };

  const dadosDialog = (
    <DadosAdministracaoDialog
      dealId={dealId}
      open={dadosOpen}
      onOpenChange={setDadosOpen}
      initial={fiscal}
      onConfirmed={gerar}
    />
  );

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
          <Button
            onClick={() => setDadosOpen(true)}
            disabled={generating || !canCreateContract}
            title={canCreateContract ? undefined : NO_PERMISSION_HINT}
            className="mt-4"
          >
            {generating ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <FileSignature className="mr-1.5 h-4 w-4" />
            )}
            Gerar contrato de administração
          </Button>
        </CardContent>
        {dadosDialog}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDadosOpen(true)}
          disabled={generating || !canCreateContract}
          title={canCreateContract ? undefined : NO_PERMISSION_HINT}
        >
          {generating ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-4 w-4" />
          )}
          Revisar dados e regerar
        </Button>
      </div>
      {dadosDialog}
      <ContractEditorPage
        contract={adminContract}
        versions={adminVersions}
        settingsFamily="locacao"
        orgDefaults={orgDefaults}
        signCta={{
          onClick: () =>
            signRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        }}
      />
      <Separator />
      <div ref={signRef}>
        <LeaseSignaturesTab
          contractId={adminContract.id}
          contractStatus={adminContract.status}
          data={signerData}
          variant="administracao"
          imobiliaria={{ nome: imobiliariaNome }}
        />
      </div>
    </div>
  );
}
