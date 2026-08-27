import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import {
  resolveOrgContractDefaults,
  resolveOrgLocacaoComissao,
} from "@/lib/contracts/default-config";
import { getOrgModules, isModuleEnabled } from "@/lib/modules/read";
import { MODULE } from "@/lib/modules/catalog";
import { FormSettingsClient } from "./FormSettingsClient";
import { ContractDefaultsCard } from "./ContractDefaultsCard";
import { ParticipantCategoriesCard } from "./ParticipantCategoriesCard";
import { ParticipantVisibilityCard } from "./ParticipantVisibilityCard";
import { GarantiaOptionsCard } from "./GarantiaOptionsCard";
import { listOrgParticipantCategories } from "@/lib/forms/participant-category-repo";
import { listGarantiaOptions } from "@/lib/forms/garantia-option-repo";

export default async function FormularioSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/login");

  // Lazy create (idêntico ao branding). Mantém row "legado" pra orgs antigas.
  let settings = await prisma.orgFormSettings.findUnique({
    where: { orgId: org.id },
  });
  if (!settings) {
    settings = await prisma.orgFormSettings.create({
      data: { orgId: org.id },
    });
  }

  // A aba "Locação" do padrão contratual só existe pra quem tem o módulo.
  const locacaoEnabled = isModuleEnabled(
    await getOrgModules(org.id),
    MODULE.LOCACAO
  );
  const defaults = resolveOrgContractDefaults(settings.contractDefaultsJson);
  const comissaoLocacao = resolveOrgLocacaoComissao(settings.contractDefaultsJson);

  // Categorias de terceiro (links por parte com campos customizáveis).
  const participantCategories = await listOrgParticipantCategories(org.id);

  // Catálogo de garantias — só faz sentido pra quem tem locação. Org sem row
  // nenhuma recebe os defaults (sem `id`), que a tela mostra como "Sugerida".
  const garantiaOptions = locacaoEnabled ? await listGarantiaOptions(org.id) : [];

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
          <Link href="/settings">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Voltar para Configurações
          </Link>
        </Button>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Formulário público</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Defina quais campos do formulário <code>/f/[token]</code> são
          obrigatórios, por esteira. Essencial cobre o mínimo pra gerar o
          contrato e mandar assinar; Completo cobre a qualificação inteira que
          os modelos e as certidões usam.
        </p>
      </div>

      <FormSettingsClient
        locacaoEnabled={locacaoEnabled}
        initial={{
          preset: settings.preset,
          customRequiredPaths: settings.customRequiredPaths as unknown,
          locacaoPreset: settings.locacaoPreset,
          locacaoCustomRequiredPaths:
            settings.locacaoCustomRequiredPaths as unknown,
          autoLockFormOnFinalize: settings.autoLockFormOnFinalize,
          summaryRecipientEmail: settings.summaryRecipientEmail,
          autoSendSummaryOnComplete: settings.autoSendSummaryOnComplete,
          summaryIncludeAttachments: settings.summaryIncludeAttachments,
        }}
      />

      <ParticipantVisibilityCard
        initial={settings.participantVisibilityJson}
        locacaoEnabled={locacaoEnabled}
      />

      <ParticipantCategoriesCard
        initial={participantCategories}
        locacaoEnabled={locacaoEnabled}
      />

      {locacaoEnabled && <GarantiaOptionsCard initial={garantiaOptions} />}

      <ContractDefaultsCard
        initial={defaults.venda}
        initialLocacao={defaults.locacao}
        initialComissaoLocacao={comissaoLocacao}
        locacaoEnabled={locacaoEnabled}
      />
    </div>
  );
}
