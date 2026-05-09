"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import ChargeWizard from "@/components/financeiro/ChargeWizard";

/**
 * Cobrança avulsa standalone (sem deal). UI 100% delegada ao ChargeWizard
 * em mode="avulsa_standalone" — search/cria AsaasCustomer, aceita
 * categoryLabel obrigatório, e não exibe etapa de splits (avulsas usam
 * SplitEditor genérico se quiserem, mas raro).
 */
export default function NovaCobrancaPage() {
  const router = useRouter();

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/financeiro/cobrancas">
          <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
        </Link>
      </Button>

      <ChargeWizard
        mode="avulsa_standalone"
        onCreated={(charge) => {
          router.push(`/financeiro/cobrancas/${charge.id}`);
        }}
      />
    </div>
  );
}
