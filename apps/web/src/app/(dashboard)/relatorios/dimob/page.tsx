import { auth, getUserOrg } from "@/lib/auth/auth";
import { PageHeader } from "@/components/layout/page-header";
import { DimobReportClient } from "@/components/dimob/DimobReportClient";

export const dynamic = "force-dynamic";

/**
 * /relatorios/dimob — geração da DIMOB de vendas (registros R01 + R04).
 * Seletor de ano, revisão das operações, painel de pendências e download do TXT.
 */
export default async function DimobReportPage() {
  const session = await auth();
  if (!session?.user) return null;
  const org = await getUserOrg(session.user.id);
  if (!org) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="DIMOB — Declaração de Atividades Imobiliárias"
        description="Gera o arquivo TXT de intermediação de vendas para importar no programa da Receita. Revise as pendências antes de gerar."
      />
      <DimobReportClient />
    </div>
  );
}
