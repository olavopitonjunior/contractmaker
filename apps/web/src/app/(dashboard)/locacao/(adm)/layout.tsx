// Route group das superfícies ADMINISTRATIVAS de locação (dashboard, imóveis,
// contratos, cobranças, repasses, despesas, vistorias, pessoas, seguros).
// Gateado por `locacao.adm` — default OFF desde 2026-08-20 (escondido de todos
// os tenants; religa por tenant no painel super-admin).
//
// Ficam FORA do grupo (gate só do módulo, no layout pai): `deals/` (o deal
// detail é superfície do PIPELINE de locação, que continua ligado), `esteira/`
// (redirect legado pro pipeline) e `newton/` (guard próprio LOCACAO_NEWTON).
// O route group não muda URL — /locacao/* continua igual.

import { requireFeaturePage } from "@/lib/modules/page-guard";
import { FEATURE } from "@/lib/modules/catalog";

export default async function LocacaoAdmLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireFeaturePage(FEATURE.LOCACAO_ADM);
  return <>{children}</>;
}
