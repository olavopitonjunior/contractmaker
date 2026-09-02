import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import {
  isKnownFormPath,
  isKnownLocacaoFormPath,
  LOCACAO_PRESET_VALUES,
  VENDA_PRESET_VALUES,
} from "@/lib/forms/presets";
import {
  contractSettingsSchema,
  locacaoComissaoDefaultsSchema,
  locacaoRecebimentoSchema,
  locacaoSettingsSchema,
} from "@/lib/contracts/default-config";
import { parseParticipantVisibilityJson } from "@/lib/forms/participant-visibility";

// Aceita os valores LEGADOS de venda (legado/minimo/padrao) além dos canônicos
// da UI nova (essencial/completo/custom) — o campo é String no banco e não há
// migração de dados. Ver lib/forms/presets.ts.
const PRESETS = VENDA_PRESET_VALUES;
const LOCACAO_PRESETS = LOCACAO_PRESET_VALUES;

// 7 etapas → índices válidos 0..6 (era 0..7, que aceitava um step inexistente
// cujo override nunca casava em resolveRequiredFields → obrigatoriedade fantasma).
function customPathItemSchema(isKnown: (path: string) => boolean) {
  return z.object({
    step: z.number().int().min(0).max(6),
    path: z
      .string()
      .min(1)
      .max(120)
      // Restringe a paths plausíveis do form (letras, dígitos, ., _, -, []).
      // Evita injeção via path malformado em qualquer consumidor futuro.
      .regex(/^[a-zA-Z0-9_.[\]\-]+$/, "Path inválido")
      // Rejeita paths órfãos (campo renomeado/typo): sem isto, viram string morta
      // que nunca dispara obrigatoriedade. Normaliza índices de array antes de checar.
      .refine(isKnown, "Path desconhecido — não corresponde a um campo do formulário"),
  });
}

const customRequiredPathItemSchema = customPathItemSchema(isKnownFormPath);
const locacaoCustomRequiredPathItemSchema = customPathItemSchema(
  isKnownLocacaoFormPath,
);

const formSettingsPatchSchema = z.object({
  preset: z.enum(PRESETS).optional(),
  customRequiredPaths: z.array(customRequiredPathItemSchema).max(200).optional(),
  // Par espelhado pra LOCAÇÃO — paths e steps são de outro schema, por isso
  // colunas separadas em vez de um objeto único.
  locacaoPreset: z.enum(LOCACAO_PRESETS).optional(),
  locacaoCustomRequiredPaths: z
    .array(locacaoCustomRequiredPathItemSchema)
    .max(200)
    .optional(),
  autoLockFormOnFinalize: z.boolean().optional(),
  // Exigir os dados de recebimento do corretor na etapa Comissão (as duas
  // esteiras). Vale só para quem preenche como MEMBRO da imobiliária — o
  // cliente anônimo não vê nem pode enviar esses campos.
  requireCommissionerReceiving: z.boolean().optional(),
  // Resumo consolidado por e-mail. String vazia limpa o destinatário.
  summaryRecipientEmail: z
    .union([z.string().email("E-mail inválido"), z.literal("")])
    .optional(),
  autoSendSummaryOnComplete: z.boolean().optional(),
  summaryIncludeAttachments: z.boolean().optional(),
  /**
   * Padrão de configurações contratuais da imobiliária, aplicado na geração de
   * contratos novos (lib/services/contract-generation.ts) e usado como piso na
   * aba "Configurações" do editor.
   *
   * Namespaced por módulo: em venda `foro` é enum, em locação é comarca em
   * texto livre — um objeto único corromperia uma das duas esteiras. Os dois
   * branches são opcionais e o PATCH é parcial (ver merge abaixo).
   */
  contractDefaults: z
    .object({
      venda: contractSettingsSchema.optional(),
      locacao: locacaoSettingsSchema.optional(),
      // Branch COMERCIAL da locação (comissão do 1º aluguel). Separado do
      // `locacao` porque aquele descreve cláusulas e é validado por contrato em
      // `api/contracts/[id]/settings` — ver o comentário no schema.
      locacao_comissao: locacaoComissaoDefaultsSchema.optional(),
      // Onde a PRÓPRIA imobiliária recebe a comissão — vira a chave
      // `{{imobiliaria_dados_pagamento}}` do contrato de locação. Mesmo
      // tratamento: branch mesclado, nunca substituído.
      locacao_recebimento: locacaoRecebimentoSchema.optional(),
    })
    .optional(),
  /**
   * Visibilidade de seções por link de parte, namespaced por esteira. O shape
   * fino (papéis válidos por esteira, etapas habilitáveis, etapa 0 sempre
   * presente, etapa 6/Comissão nunca) é imposto por
   * `parseParticipantVisibilityJson` ANTES de gravar — o Zod aqui só limita o
   * envelope. Merge por branch, como o contractDefaults.
   */
  participantVisibility: z
    .object({
      venda: z.record(z.array(z.number().int().min(0).max(6)).max(10)).optional(),
      locacao: z.record(z.array(z.number().int().min(0).max(6)).max(10)).optional(),
    })
    .optional(),
});

/**
 * Cria a row caso não exista — mesma estratégia lazy do branding.
 * Default `preset: "legado"` preserva fluxos ativos em orgs criadas antes
 * da migração 20260515120000_org_form_settings.
 */
async function ensureRow(orgId: string) {
  const existing = await prisma.orgFormSettings.findUnique({ where: { orgId } });
  if (existing) return existing;
  return prisma.orgFormSettings.create({ data: { orgId } });
}

export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  // GET é leitura — qualquer membro da org pode consultar o preset atual.
  // Form-setting determina UX do form público, não dado sensível.
  const settings = await ensureRow(ctx.orgId);
  return NextResponse.json({ settings });
}

export async function PATCH(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.ORG_SETTINGS_EDIT,
    });
  } catch (err) {
    if (
      err instanceof PermissionDeniedError ||
      err instanceof MembershipRequiredError
    ) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = formSettingsPatchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 },
    );
  }

  // Quando preset !== "custom" mas o user mandou customRequiredPaths, os
  // paths viram override em cima do preset. Quando preset === "custom" e
  // não veio customRequiredPaths no payload, MANTÉM o existing.
  const row = await ensureRow(ctx.orgId);

  // `contractDefaults` é MESCLADO por branch, nunca substituído: a tela de
  // padrões salva uma aba por vez, e um replace do Json inteiro apagaria o
  // padrão da outra esteira em silêncio.
  const currentDefaults =
    (row.contractDefaultsJson as Record<string, unknown> | null) ?? {};
  const mergedDefaults = parsed.data.contractDefaults
    ? { ...currentDefaults, ...parsed.data.contractDefaults }
    : null;

  // Visibilidade por link: merge por branch (a tela salva uma esteira por
  // vez) e SANITIZA antes de gravar — o que persiste já é o shape canônico
  // (papéis da esteira certa, etapas do catálogo, etapa 0 garantida).
  const currentVisibility =
    (row.participantVisibilityJson as Record<string, unknown> | null) ?? {};
  const mergedVisibility = parsed.data.participantVisibility
    ? parseParticipantVisibilityJson({
        ...currentVisibility,
        ...parsed.data.participantVisibility,
      })
    : null;

  const updated = await prisma.orgFormSettings.update({
    where: { orgId: ctx.orgId },
    data: {
      ...(parsed.data.preset !== undefined ? { preset: parsed.data.preset } : {}),
      ...(parsed.data.customRequiredPaths !== undefined
        ? { customRequiredPaths: parsed.data.customRequiredPaths }
        : {}),
      ...(parsed.data.locacaoPreset !== undefined
        ? { locacaoPreset: parsed.data.locacaoPreset }
        : {}),
      ...(parsed.data.locacaoCustomRequiredPaths !== undefined
        ? { locacaoCustomRequiredPaths: parsed.data.locacaoCustomRequiredPaths }
        : {}),
      ...(parsed.data.autoLockFormOnFinalize !== undefined
        ? { autoLockFormOnFinalize: parsed.data.autoLockFormOnFinalize }
        : {}),
      ...(parsed.data.requireCommissionerReceiving !== undefined
        ? {
            requireCommissionerReceiving:
              parsed.data.requireCommissionerReceiving,
          }
        : {}),
      ...(parsed.data.summaryRecipientEmail !== undefined
        ? { summaryRecipientEmail: parsed.data.summaryRecipientEmail || null }
        : {}),
      ...(parsed.data.autoSendSummaryOnComplete !== undefined
        ? { autoSendSummaryOnComplete: parsed.data.autoSendSummaryOnComplete }
        : {}),
      ...(parsed.data.summaryIncludeAttachments !== undefined
        ? { summaryIncludeAttachments: parsed.data.summaryIncludeAttachments }
        : {}),
      ...(mergedDefaults ? { contractDefaultsJson: mergedDefaults as object } : {}),
      ...(mergedVisibility ? { participantVisibilityJson: mergedVisibility as object } : {}),
    },
  });

  audit(
    {
      orgId: ctx.orgId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    {
      action: "FORM_SETTINGS_UPDATE",
      result: "SUCCESS",
      resourceType: "org_form_settings",
      resource: updated.id,
      metadata: {
        preset: updated.preset,
        customRequiredPathsCount: Array.isArray(parsed.data.customRequiredPaths)
          ? parsed.data.customRequiredPaths.length
          : undefined,
        locacaoPreset: updated.locacaoPreset,
        locacaoCustomRequiredPathsCount: Array.isArray(
          parsed.data.locacaoCustomRequiredPaths,
        )
          ? parsed.data.locacaoCustomRequiredPaths.length
          : undefined,
      },
    },
  );

  return NextResponse.json({ settings: updated });
}
