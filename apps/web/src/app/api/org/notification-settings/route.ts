import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
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
  DEAL_NOTIF_EVENTS,
  resolveEffectiveNotificationConfig,
} from "@/lib/notifications/deal-events-config";

/**
 * Padrão da org das notificações do processo → corretores (espelha o padrão
 * de /api/org/form-settings: GET pra qualquer membro, PATCH com
 * ORG_SETTINGS_EDIT + Zod + audit). O blob persiste SÓ divergências dos
 * defaults de código; o GET devolve também a config resolvida pra UI.
 */

const channelTogglesSchema = z
  .object({
    email: z.boolean().optional(),
    whatsapp: z.boolean().optional(),
  })
  .strict();

const eventTogglesSchema = z
  .object({ broker: channelTogglesSchema.optional() })
  .strict();

const settingsPatchSchema = z
  .object({
    events: z
      .object(
        Object.fromEntries(
          DEAL_NOTIF_EVENTS.map((ev) => [ev, eventTogglesSchema.optional()])
        ) as Record<
          (typeof DEAL_NOTIF_EVENTS)[number],
          z.ZodOptional<typeof eventTogglesSchema>
        >
      )
      .strict()
      .optional(),
    formReminder: z
      .object({
        enabled: z.boolean().optional(),
        days: z.array(z.number().int().min(1).max(60)).max(10).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

async function ensureRow(orgId: string) {
  const existing = await prisma.orgNotificationSettings.findUnique({
    where: { orgId },
  });
  if (existing) return existing;
  return prisma.orgNotificationSettings.create({ data: { orgId } });
}

export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const settings = await ensureRow(ctx.orgId);
  const resolved = await resolveEffectiveNotificationConfig(ctx.orgId);
  return NextResponse.json({ settings, resolved });
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
  const parsed = settingsPatchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  // Merge preservando chaves não enviadas (mesma semântica de
  // Deal.complianceJson). Events fundem POR CANAL — merge raso por evento
  // perderia o override do canal irmão (ligar whatsapp e depois desligar
  // email apagaria o whatsapp salvo). formReminder funde por campo.
  const existing = await ensureRow(ctx.orgId);
  const current =
    (existing.settingsJson as Record<string, unknown> | null) ?? {};
  const currentEvents =
    (current.events as Record<string, Record<string, unknown>> | undefined) ??
    {};
  let mergedEvents: Record<string, unknown> | undefined;
  if (parsed.data.events !== undefined) {
    mergedEvents = { ...currentEvents };
    for (const [ev, toggles] of Object.entries(parsed.data.events)) {
      if (!toggles) continue;
      const curBroker =
        (currentEvents[ev]?.broker as Record<string, unknown> | undefined) ??
        {};
      mergedEvents[ev] = { broker: { ...curBroker, ...toggles.broker } };
    }
  }
  const next = {
    ...current,
    ...(mergedEvents !== undefined ? { events: mergedEvents } : {}),
    ...(parsed.data.formReminder !== undefined
      ? {
          formReminder: {
            ...((current.formReminder as object | undefined) ?? {}),
            ...parsed.data.formReminder,
          },
        }
      : {}),
  };

  const updated = await prisma.orgNotificationSettings.update({
    where: { orgId: ctx.orgId },
    data: { settingsJson: next as Prisma.InputJsonValue },
  });

  audit(
    {
      orgId: ctx.orgId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    {
      action: "NOTIFICATION_SETTINGS_UPDATED",
      result: "SUCCESS",
      resourceType: "org_notification_settings",
      resource: updated.id,
      metadata: {
        eventsPatched: parsed.data.events
          ? Object.keys(parsed.data.events)
          : undefined,
        formReminderPatched: parsed.data.formReminder !== undefined,
      },
    }
  );

  const resolved = await resolveEffectiveNotificationConfig(ctx.orgId);
  return NextResponse.json({ settings: updated, resolved });
}
