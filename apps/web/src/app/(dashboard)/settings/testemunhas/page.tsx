import { redirect } from "next/navigation";

// Consolidado na área unificada de Assinaturas (aba Testemunhas).
export default function DefaultWitnessesSettingsPage() {
  redirect("/settings/signatures?tab=testemunhas");
}
