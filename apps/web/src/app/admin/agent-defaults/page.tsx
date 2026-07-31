import { redirect } from "next/navigation";

/**
 * Aposentada pelo console unificado. Os overrides dos 4 especialistas viraram
 * linhas de AgentProfile com orgId = null e são editados em /admin/agents,
 * junto dos demais agentes.
 *
 * Mantida como redirect porque o caminho circula em links e bookmarks do time.
 */
export default function AgentDefaultsRedirect() {
  redirect("/admin/agents");
}
