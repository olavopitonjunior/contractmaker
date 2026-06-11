// Workspace de Locação. A navegação entre as superfícies agora mora na sidebar
// principal (grupo "ADM Locação"); a antiga sub-nav horizontal foi removida pra
// não duplicar navegação. docs/locacao/spec.md §14.2.
//
// Guard server-side do módulo: orgs sem o módulo "locacao" habilitado são
// redirecionadas pra /pipeline (o middleware é edge e não lê módulos —
// o bloqueio por entitlement acontece aqui). Ver lib/modules/.

import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getOrgModules, isModuleEnabled } from "@/lib/modules/read";
import { MODULE } from "@/lib/modules/catalog";

export default async function LocacaoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/pipeline");

  const modules = await getOrgModules(org.id);
  if (!isModuleEnabled(modules, MODULE.LOCACAO)) {
    redirect("/pipeline");
  }

  return (
    <div className="flex flex-col gap-4 px-2 py-2 sm:p-4">
      <div className="min-h-[60vh]">{children}</div>
    </div>
  );
}
