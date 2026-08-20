// Guard server-side do módulo Vendas para todas as páginas de deal
// (/deals/[dealId], /deals/new-from-proposal, /deals/new-from-upload).
// Tenant sem vendas cai na landing por entitlement (homeHref). O middleware é
// edge e não lê módulos — o bloqueio por entitlement acontece aqui.
import { requireModulePage } from "@/lib/modules/page-guard";
import { MODULE } from "@/lib/modules/catalog";

export default async function DealsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireModulePage(MODULE.VENDAS);
  return <>{children}</>;
}
