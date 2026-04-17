import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { AdhocCertidoesClient } from "./AdhocCertidoesClient";
import { ENDPOINTS } from "@/lib/certidoes/endpoints";

export const metadata = {
  title: "Diligência avulsa — Certidões",
};

/**
 * Phase C — página de consulta ad-hoc de certidões.
 *
 * Permite rodar Infosimples para um CPF/CNPJ que não é parte de nenhum Deal
 * — útil para diligenciar sócios de PJ, fiadores, testemunhas etc. Usa o
 * mesmo budget + engine do fluxo Deal-scoped.
 */
export default async function AdhocCertidoesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/login");

  // Serialize just the endpoint catalog entries a user is likely to pick for
  // a person (no property-only endpoints like IPTU — those need an imóvel).
  const personEndpoints = Object.values(ENDPOINTS)
    .filter((e) => e.appliesTo.includes("pessoa"))
    .map((e) => ({
      id: e.id,
      label: e.label,
      costCents: e.costCents,
      scope: e.scope,
      uf: e.uf ?? null,
      category: e.category,
      description: e.description ?? null,
    }));

  return <AdhocCertidoesClient endpoints={personEndpoints} />;
}
