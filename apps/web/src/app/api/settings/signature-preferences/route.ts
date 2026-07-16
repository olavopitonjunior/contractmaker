import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import { requireClickSignAdmin } from "@/lib/clicksign/settings-guard";
import { getSignatureSettings } from "@/lib/clicksign/account";

export const runtime = "nodejs";

const AUTH_METHODS = ["email", "whatsapp", "selfie", "icp_brasil"] as const;

const patchSchema = z
  .object({
    monthlyBudgetCents: z.number().int().positive().nullable().optional(),
    costOverridesJson: z
      .record(z.enum(AUTH_METHODS), z.number().int().nonnegative())
      .nullable()
      .optional(),
    defaultAuthMethod: z.enum(AUTH_METHODS).optional(),
    allowedAuthMethods: z.array(z.enum(AUTH_METHODS)).min(1).optional(),
    defaultLocale: z.enum(["pt-BR", "en-US"]).optional(),
    autoClose: z.boolean().optional(),
    refusable: z.boolean().optional(),
    defaultDeadlineDays: z.number().int().positive().max(365).nullable().optional(),
    defaultSequential: z.boolean().optional(),
    proposalEmailSubject: z.string().max(200).nullable().optional(),
    proposalEmailMessage: z.string().max(2000).nullable().optional(),
  })
  .refine(
    (d) =>
      !d.defaultAuthMethod ||
      !d.allowedAuthMethods ||
      d.allowedAuthMethods.includes(d.defaultAuthMethod),
    { message: "O método padrão precisa estar entre os métodos permitidos." }
  );

export async function GET() {
  const gate = await requireClickSignAdmin();
  if (!gate.ok) return gate.response;
  const settings = await getSignatureSettings(gate.ctx.orgId);
  return NextResponse.json({ settings });
}

export async function PATCH(req: NextRequest) {
  const gate = await requireClickSignAdmin();
  if (!gate.ok) return gate.response;
  const { orgId, userId } = gate.ctx;

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Garante que a row exista (lazy-create com defaults) antes do update.
  const current = await getSignatureSettings(orgId);
  const d = parsed.data;

  // Cross-check final: método padrão precisa estar na allow-list resultante.
  const nextAllowed = d.allowedAuthMethods ?? current.allowedAuthMethods;
  const nextDefault = d.defaultAuthMethod ?? current.defaultAuthMethod;
  if (!nextAllowed.includes(nextDefault)) {
    return NextResponse.json(
      { error: "O método padrão precisa estar entre os métodos permitidos." },
      { status: 400 }
    );
  }

  const settings = await prisma.orgSignatureSettings.update({
    where: { orgId },
    data: {
      ...(d.monthlyBudgetCents !== undefined
        ? { monthlyBudgetCents: d.monthlyBudgetCents }
        : {}),
      ...(d.costOverridesJson !== undefined
        ? {
            costOverridesJson:
              d.costOverridesJson === null
                ? Prisma.DbNull
                : d.costOverridesJson,
          }
        : {}),
      ...(d.defaultAuthMethod !== undefined
        ? { defaultAuthMethod: d.defaultAuthMethod }
        : {}),
      ...(d.allowedAuthMethods !== undefined
        ? { allowedAuthMethods: d.allowedAuthMethods }
        : {}),
      ...(d.defaultLocale !== undefined ? { defaultLocale: d.defaultLocale } : {}),
      ...(d.autoClose !== undefined ? { autoClose: d.autoClose } : {}),
      ...(d.refusable !== undefined ? { refusable: d.refusable } : {}),
      ...(d.defaultDeadlineDays !== undefined
        ? { defaultDeadlineDays: d.defaultDeadlineDays }
        : {}),
      ...(d.defaultSequential !== undefined
        ? { defaultSequential: d.defaultSequential }
        : {}),
      ...(d.proposalEmailSubject !== undefined
        ? { proposalEmailSubject: d.proposalEmailSubject || null }
        : {}),
      ...(d.proposalEmailMessage !== undefined
        ? { proposalEmailMessage: d.proposalEmailMessage || null }
        : {}),
    },
  });

  await audit(
    { orgId, userId },
    {
      action: "CLICKSIGN_SETTINGS_UPDATED",
      result: "SUCCESS",
      resourceType: "OrgSignatureSettings",
    }
  ).catch(() => {});

  return NextResponse.json({ settings });
}
