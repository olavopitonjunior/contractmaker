import { prisma } from "@/lib/db/prisma";
import {
  locacaoSettingsForForm,
  moduleFormSettings,
  resolveAllRequiredFieldsForModule,
} from "@/lib/forms/presets";

/**
 * Snapshot do preset de obrigatoriedade gravado em `SalesForm.requiredPreset`
 * no momento da CRIAÇÃO do formulário.
 *
 * Só LOCAÇÃO grava — venda continua resolvendo `OrgFormSettings.preset` ao
 * vivo (comportamento histórico, mantido pra não mudar formulário nenhum sem
 * alguém pedir). Na locação a configuração é nova, então precisa da trava de
 * retrocompat: link já enviado ao cliente não pode passar a exigir campos que
 * a imobiliária escolheu depois.
 *
 * Retorna `null` quando não é locação ou quando a org nunca criou a row de
 * settings — e `null` significa, na leitura, "comportamento antigo".
 */
export async function resolveRequiredPresetSnapshot(
  orgId: string,
  schemaType: string | null | undefined,
): Promise<string | null> {
  if (!schemaType?.startsWith("locacao")) return null;
  try {
    const settings = await prisma.orgFormSettings.findUnique({
      where: { orgId },
      select: { locacaoPreset: true },
    });
    return settings?.locacaoPreset ?? null;
  } catch (err) {
    // Snapshot é conveniência de configuração — nunca pode derrubar a criação
    // do formulário/negócio. Sem ele o form cai no comportamento antigo.
    console.error("[required-snapshot] falhou ao resolver preset:", err);
    return null;
  }
}

export interface FormRequiredScope {
  orgId: string;
  schemaType: string | null | undefined;
  requiredPreset: string | null | undefined;
}

/**
 * Campos obrigatórios por step (7 posições) DESTE formulário — ponto único de
 * verdade das páginas públicas (`/f/[token]`, `/f/p/[subtoken]`) e dos
 * finalizes server-side.
 *
 *  - VENDA: resolve `OrgFormSettings.preset` ao vivo (comportamento histórico).
 *  - LOCAÇÃO: resolve o SNAPSHOT gravado no formulário; `null`/"legado" →
 *    arrays vazios, ou seja, o comportamento anterior à configuração.
 */
export async function resolveFormRequiredFields(
  form: FormRequiredScope,
): Promise<string[][]> {
  const isLocacao = form.schemaType?.startsWith("locacao") ?? false;
  const settings = await prisma.orgFormSettings.findUnique({
    where: { orgId: form.orgId },
    select: {
      preset: true,
      customRequiredPaths: true,
      locacaoPreset: true,
      locacaoCustomRequiredPaths: true,
    },
  });

  const resolved = isLocacao
    ? resolveAllRequiredFieldsForModule(
        "locacao",
        locacaoSettingsForForm(settings, form.requiredPreset),
      )
    : resolveAllRequiredFieldsForModule(
        "venda",
        moduleFormSettings(settings, "venda"),
      );

  return resolved.map((paths) => Array.from(paths));
}

/**
 * Recorta os obrigatórios pro escopo de UM link por parte: só os steps que o
 * role enxerga (ROLE_STEP_INDEXES) e só os paths cuja chave top-level está na
 * allowlist do role (ROLE_PATHS). Sem o recorte, o locatário seria cobrado
 * pelos campos do imóvel — que a tela dele nem renderiza.
 */
export function requiredPathsForRoleScope(
  byStep: readonly (readonly string[])[],
  stepIndexes: readonly number[],
  allowedTopKeys: readonly string[],
): string[] {
  const allow = new Set(allowedTopKeys);
  const out = new Set<string>();
  for (const step of stepIndexes) {
    for (const path of byStep[step] ?? []) {
      if (allow.has(path.split(".")[0])) out.add(path);
    }
  }
  return Array.from(out);
}
