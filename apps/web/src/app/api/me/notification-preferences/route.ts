import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import {
  USER_NOTIF_CATEGORIES,
  type UserNotifCategory,
  type UserNotificationPrefsJson,
} from "@/lib/notifications/user-channels-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Preferências de canal externo do próprio usuário, na org ativa.
 *
 * Sempre escopado em `session.user.id` — não há parâmetro de usuário, então
 * não existe superfície pra alterar preferência alheia. O consentimento
 * (`whatsappOptInAt`) é carimbado quando a primeira categoria é ligada e
 * zerado quando a última é desligada: assim o "sim" fica datado, e revogar
 * apaga o registro em vez de deixá-lo pendurado.
 */

const categoryEnum = z.enum(
  USER_NOTIF_CATEGORIES as unknown as [UserNotifCategory, ...UserNotifCategory[]]
);

const patchSchema = z
  .object({
    events: z
      .record(categoryEnum, z.object({ whatsapp: z.boolean() }).strict())
      .optional(),
  })
  .strict();

function coercePrefs(raw: unknown): UserNotificationPrefsJson {
  if (typeof raw !== "object" || raw === null) return {};
  return raw as UserNotificationPrefsJson;
}

function anyChannelOn(prefs: UserNotificationPrefsJson): boolean {
  return USER_NOTIF_CATEGORIES.some(
    (c) => prefs.events?.[c]?.whatsapp === true
  );
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "Org não encontrada" }, { status: 404 });
  }

  const [row, user, orgSettings] = await Promise.all([
    prisma.userNotificationPreference.findUnique({
      where: { userId_orgId: { userId: session.user.id, orgId: org.id } },
      select: { settingsJson: true, whatsappOptInAt: true },
    }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { phone: true },
    }),
    prisma.orgNotificationSettings.findUnique({
      where: { orgId: org.id },
      select: { settingsJson: true },
    }),
  ]);

  const settings = (orgSettings?.settingsJson ?? {}) as {
    userChannels?: { enabled?: boolean; events?: Record<string, boolean> };
  };

  return NextResponse.json({
    events: coercePrefs(row?.settingsJson).events ?? {},
    whatsappOptInAt: row?.whatsappOptInAt?.toISOString() ?? null,
    // A UI precisa saber por que um toggle ligado pode não estar valendo.
    phone: user?.phone ?? null,
    orgBlocked: settings.userChannels?.enabled === false,
    orgBlockedCategories: Object.entries(settings.userChannels?.events ?? {})
      .filter(([, v]) => v === false)
      .map(([k]) => k),
  });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "Org não encontrada" }, { status: 404 });
  }

  let input: z.infer<typeof patchSchema>;
  try {
    input = patchSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "Payload inválido", details: (err as z.ZodError).issues },
      { status: 400 }
    );
  }
  if (!input.events) {
    return NextResponse.json({ error: "Nada a atualizar" }, { status: 400 });
  }

  const existing = await prisma.userNotificationPreference.findUnique({
    where: { userId_orgId: { userId: session.user.id, orgId: org.id } },
    select: { settingsJson: true, whatsappOptInAt: true },
  });
  const current = coercePrefs(existing?.settingsJson);

  // Merge por categoria — PATCH parcial não apaga o que não veio.
  const merged: UserNotificationPrefsJson = {
    events: { ...(current.events ?? {}) },
  };
  for (const [category, toggles] of Object.entries(input.events)) {
    if (!toggles) continue;
    merged.events![category as UserNotifCategory] = { whatsapp: toggles.whatsapp };
  }

  const turningOn = anyChannelOn(merged);
  // Carimba na 1ª ativação; limpa quando o usuário desliga tudo (revogação).
  const whatsappOptInAt = turningOn
    ? (existing?.whatsappOptInAt ?? new Date())
    : null;

  if (turningOn) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { phone: true },
    });
    if (!user?.phone) {
      return NextResponse.json(
        {
          error:
            "Cadastre seu telefone no perfil antes de ativar avisos por WhatsApp.",
        },
        { status: 422 }
      );
    }
  }

  const settingsJson = merged as unknown as Prisma.InputJsonValue;
  await prisma.userNotificationPreference.upsert({
    where: { userId_orgId: { userId: session.user.id, orgId: org.id } },
    create: {
      userId: session.user.id,
      orgId: org.id,
      settingsJson,
      whatsappOptInAt,
    },
    update: { settingsJson, whatsappOptInAt },
  });

  await audit(
    { orgId: org.id, userId: session.user.id },
    {
      action: "USER_NOTIFICATION_PREFS_UPDATE",
      result: "SUCCESS",
      resource: session.user.id,
      resourceType: "User",
      metadata: {
        events: merged.events,
        // O consentimento é o que autoriza o envio — registrar a transição
        // é o que dá rastro de quando o usuário disse sim (e quando revogou).
        consented: Boolean(whatsappOptInAt),
      },
    }
  );

  return NextResponse.json({
    events: merged.events ?? {},
    whatsappOptInAt: whatsappOptInAt?.toISOString() ?? null,
  });
}
