import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import { requireClickSignAdmin } from "@/lib/clicksign/settings-guard";
import { getSignatureSettings } from "@/lib/clicksign/account";

export const runtime = "nodejs";

const AUTH_METHODS = ["email", "whatsapp", "selfie", "icp_brasil"] as const;

const patchSchema = z
  .object({
    // `monthlyBudgetCents` e `costOverridesJson` saíram do contrato: não há
    // mais teto de gasto nem estimativa de custo em tela.
    //   - `monthlyBudgetCents` ficou sem leitor nenhum.
    //   - `costOverridesJson` CONTINUA sendo lida (alimenta `Envelope.costCents`
    //     via costs.ts), só perdeu o escritor — ajustar override agora é
    //     operação de banco. NÃO apagar a coluna achando que é órfã.
    // Limpeza de qualquer uma delas é migration própria.
    defaultAuthMethod: z.enum(AUTH_METHODS).optional(),
    allowedAuthMethods: z.array(z.enum(AUTH_METHODS)).min(1).optional(),
    defaultLocale: z.enum(["pt-BR", "en-US"]).optional(),
    autoClose: z.boolean().optional(),
    refusable: z.boolean().optional(),
    defaultDeadlineDays: z.number().int().positive().max(365).nullable().optional(),
    defaultSequential: z.boolean().optional(),
    proposalEmailSubject: z.string().max(200).nullable().optional(),
    proposalEmailMessage: z.string().max(2000).nullable().optional(),
    proposalAutoChainVendedor: z.boolean().optional(),
    proposalOwnerDeadlineDays: z.number().int().positive().max(365).nullable().optional(),
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
      ...(d.proposalAutoChainVendedor !== undefined
        ? { proposalAutoChainVendedor: d.proposalAutoChainVendedor }
        : {}),
      ...(d.proposalOwnerDeadlineDays !== undefined
        ? { proposalOwnerDeadlineDays: d.proposalOwnerDeadlineDays }
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
