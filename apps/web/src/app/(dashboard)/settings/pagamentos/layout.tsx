// Guard único da subárvore /settings/pagamentos/* (contas, contas/nova,
// contas/[id], contas/[id]/permissoes, split-recipients, branding, taxas).
// Gateado por `vendas.pagadoria` — default OFF desde 2026-08-20. Um layout
// cobre sub-rotas futuras sem depender de guard por página.
//
// NÃO gatear as APIs /api/financeiro/split-recipients/* por esta feature:
// a tela /corretores (registry de notificações) consome essas rotas com
// kind="commissioner" independente da pagadoria.

import { requireFeaturePage } from "@/lib/modules/page-guard";
import { FEATURE } from "@/lib/modules/catalog";

export default async function SettingsPagamentosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireFeaturePage(FEATURE.VENDAS_PAGADORIA, "/settings");
  return <>{children}</>;
}
