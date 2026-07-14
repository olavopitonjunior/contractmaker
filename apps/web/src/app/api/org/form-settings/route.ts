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
import { isKnownFormPath } from "@/lib/forms/presets";

const PRESETS = ["legado", "minimo", "padrao", "completo", "custom"] as const;

// 7 etapas → índices válidos 0..6 (era 0..7, que aceitava um step inexistente
// cujo override nunca casava em resolveRequiredFields → obrigatoriedade fantasma).
const customRequiredPathItemSchema = z.object({
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
    .refine(isKnownFormPath, "Path desconhecido — não corresponde a um campo do formulário"),
});

const formSettingsPatchSchema = z.object({
  preset: z.enum(PRESETS).optional(),
  customRequiredPaths: z.array(customRequiredPathItemSchema).max(200).optional(),
  // Resumo consolidado por e-mail. String vazia limpa o destinatário.
  summaryRecipientEmail: z
    .union([z.string().email("E-mail inválido"), z.literal("")])
    .optional(),
  autoSendSummaryOnComplete: z.boolean().optional(),
  summaryIncludeAttachments: z.boolean().optional(),
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
  await ensureRow(ctx.orgId);
  const updated = await prisma.orgFormSettings.update({
    where: { orgId: ctx.orgId },
    data: {
      ...(parsed.data.preset !== undefined ? { preset: parsed.data.preset } : {}),
      ...(parsed.data.customRequiredPaths !== undefined
        ? { customRequiredPaths: parsed.data.customRequiredPaths }
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
      },
    },
  );

  return NextResponse.json({ settings: updated });
}
