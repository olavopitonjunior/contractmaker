import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getOrgModules, isModuleEnabled } from "@/lib/modules/read";
import { MODULE } from "@/lib/modules/catalog";

export default async function HomePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  // Landing por módulo: tenant só-locação (vendas desabilitado) cai em /locacao;
  // caso contrário, /pipeline (vendas). Evita o hop /pipeline→/locacao.
  const org = await getUserOrg(session.user.id);
  if (org) {
    const modules = await getOrgModules(org.id);
    if (!isModuleEnabled(modules, MODULE.VENDAS) && isModuleEnabled(modules, MODULE.LOCACAO)) {
      redirect("/locacao");
    }
  }
  redirect("/pipeline");
}
