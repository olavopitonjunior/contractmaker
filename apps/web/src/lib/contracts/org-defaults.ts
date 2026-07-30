import { prisma } from "@/lib/db/prisma";
import {
  DEFAULT_CONTRACT_SETTINGS,
  DEFAULT_LOCACAO_SETTINGS,
  resolveOrgVendaDefaults,
  resolveOrgLocacaoDefaults,
  type ContractSettings,
  type LocacaoSettings,
} from "./default-config";

/**
 * Leitura server-side do padrão contratual da org
 * (`OrgFormSettings.contractDefaultsJson`).
 *
 * Mora fora de `contract-generation.ts` porque os Server Components do editor
 * (venda e locação) precisam do mesmo dado pra pré-popular a aba
 * Configurações, e importar o módulo de geração numa página arrastaria
 * googleapis/puppeteer pro bundle do request.
 *
 * NUNCA lança: sem row, sem coluna preenchida ou com Json inválido, cai no
 * padrão de fábrica — nem a geração de contrato nem a abertura do editor podem
 * quebrar por causa de uma preferência.
 */
export async function loadOrgContractDefaults(
  orgId: string
): Promise<ContractSettings> {
  try {
    const settings = await prisma.orgFormSettings.findUnique({
      where: { orgId },
      select: { contractDefaultsJson: true },
    });
    return resolveOrgVendaDefaults(settings?.contractDefaultsJson);
  } catch (err) {
    console.warn("[contract-defaults] falha ao carregar padrão da org:", err);
    return DEFAULT_CONTRACT_SETTINGS;
  }
}

/** Idem, branch de locação. */
export async function loadOrgLocacaoDefaults(
  orgId: string
): Promise<LocacaoSettings> {
  try {
    const settings = await prisma.orgFormSettings.findUnique({
      where: { orgId },
      select: { contractDefaultsJson: true },
    });
    return resolveOrgLocacaoDefaults(settings?.contractDefaultsJson);
  } catch (err) {
    console.warn("[contract-defaults] falha ao carregar padrão da org:", err);
    return DEFAULT_LOCACAO_SETTINGS;
  }
}
