// Guard server-side da sub-função Certidões (módulo Vendas) para todas as
// páginas de certidões (/certidoes/adhoc). Tenant sem a feature cai na landing
// por entitlement (homeHref). O middleware é edge — o bloqueio acontece aqui.
import { requireFeaturePage } from "@/lib/modules/page-guard";
import { FEATURE } from "@/lib/modules/catalog";

export default async function CertidoesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireFeaturePage(FEATURE.VENDAS_CERTIDOES);
  return <>{children}</>;
}
