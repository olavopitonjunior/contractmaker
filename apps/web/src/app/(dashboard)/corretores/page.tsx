import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { FEATURE } from "@/lib/modules/catalog";
import CorretoresClient from "@/components/corretores/CorretoresClient";

export const dynamic = "force-dynamic";

/**
 * Resolve a lente de exibição (cadastro vs financeiro) no server: com
 * FEATURE.VENDAS_PAGADORIA desligada na org, o client esconde PIX/wallet/
 * bancários e troca o alarme de "dados pendentes" por uma leitura neutra.
 */
export default async function CorretoresPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const modules = await getOrgModules(org.id);
  const pagadoriaEnabled = isFeatureEnabled(modules, FEATURE.VENDAS_PAGADORIA);

  return <CorretoresClient pagadoriaEnabled={pagadoriaEnabled} />;
}
