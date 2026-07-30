import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { waitUntil } from "@vercel/functions";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import {
  DEAL_NOTIF_EVENTS,
  resolveEffectiveNotificationConfig,
} from "@/lib/notifications/deal-events-config";
import { resolveDealBrokers } from "@/lib/notifications/deal-brokers";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION, type PermissionKey } from "@/lib/security/rbac/permissions";

export const runtime = "nodejs";

/**
 * Config de notificações POR DEAL (override do padrão da org) + histórico de
 * envios externos. PATCH segue o padrão de merge do serasa/consent: preserva
 * chaves não enviadas; auth via deal.pipeline.orgId.
 */

async function authorizeDeal(dealId: string, permission?: PermissionKey) {
  const session = await auth();
  if (!session?.user) {
    return { error: "Unauthorized", status: 401 } as const;
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return { error: "No organization", status: 400 } as const;
  }
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      id: true,
      notificationsJson: true,
      pipeline: { select: { orgId: true, kind: true } },
      form: { select: { dataJson: true } },
    },
  });
  if (!deal || deal.pipeline.orgId !== org.id) {
    return { error: "Deal not found", status: 404 } as const;
  }
  // Escopo do gerente (+ permission nas mutações).
  const denied = await guardDealScope({
    dealId,
    userId: session.user.id,
    orgId: org.id,
    permission,
  });
  if (denied) {
    return denied.status === 403
      ? ({ error: "PERMISSION_DENIED", status: 403 } as const)
      : ({ error: "Deal not found", status: 404 } as const);
  }
  return { deal, org, userId: session.user.id } as const;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const result = await authorizeDeal(params.dealId);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { deal, org } = result;

  const { searchParams } = new URL(req.url);
  const take = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200);

  const [resolved, brokers, log] = await Promise.all([
    resolveEffectiveNotificationConfig(org.id, deal.notificationsJson),
    resolveDealBrokers({
      orgId: org.id,
      formDataJson: deal.form?.dataJson ?? null,
      brokerIds: (() => {
        const j = deal.notificationsJson as { brokerIds?: unknown } | null;
        return Array.isArray(j?.brokerIds)
          ? (j!.brokerIds as unknown[]).filter(
              (x): x is string => typeof x === "string"
            )
          : [];
      })(),
    }),
    prisma.dealNotificationLog.findMany({
      where: { dealId: deal.id, orgId: org.id },
      orderBy: { createdAt: "desc" },
      take,
    }),
  ]);

  return NextResponse.json({
    overrides: deal.notificationsJson ?? {},
    resolved,
    brokers,
    log,
  });
}

const channelTogglesSchema = z
  .object({ email: z.boolean().optional(), whatsapp: z.boolean().optional() })
  .strict();
const eventTogglesSchema = z
  .object({ broker: channelTogglesSchema.optional() })
  .strict();

const patchSchema = z
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
    brokerIds: z.array(z.string().min(1)).max(20).optional(),
    muted: z.boolean().optional(),
    /** Remove o override de um evento (volta a herdar o padrão da org). */
    clearEvents: z.array(z.enum(DEAL_NOTIF_EVENTS)).optional(),
  })
  .strict();

export async function PATCH(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const result = await authorizeDeal(params.dealId, PERMISSION.DEAL_EDIT);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { deal, org, userId } = result;

  const raw = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  // brokerIds precisam existir na org (cross-org guard do picker).
  if (parsed.data.brokerIds && parsed.data.brokerIds.length > 0) {
    const count = await prisma.splitRecipient.count({
      where: {
        id: { in: parsed.data.brokerIds },
        orgId: org.id,
        kind: "commissioner",
      },
    });
    if (count !== parsed.data.brokerIds.length) {
      return NextResponse.json(
        { error: "Um ou mais corretores não pertencem a esta organização" },
        { status: 400 }
      );
    }
  }

  const existing =
    (deal.notificationsJson as Record<string, unknown> | null) ?? {};
  const existingEvents =
    (existing.events as Record<string, Record<string, unknown>> | undefined) ??
    {};

  // Merge POR CANAL — merge raso por evento perderia o override do canal
  // irmão já salvo (ligar whatsapp e depois desligar email apagaria o
  // whatsapp deste evento).
  const mergedEvents: Record<string, unknown> = { ...existingEvents };
  for (const [ev, toggles] of Object.entries(parsed.data.events ?? {})) {
    if (!toggles) continue;
    const curEvent = existingEvents[ev] ?? {};
    const curBroker = (curEvent.broker as Record<string, unknown>) ?? {};
    // Spread do evento inteiro preserva os públicos `party` e `manager`
    // (configurados no padrão da imobiliária) — sem ele, mexer no toggle do
    // corretor apagaria o override de parte/gerente deste negócio. Não há
    // override POR DEAL desses dois: quem quer silenciar um negócio inteiro
    // usa `muted`, que já corta os três públicos.
    mergedEvents[ev] = { ...curEvent, broker: { ...curBroker, ...toggles.broker } };
  }
  for (const ev of parsed.data.clearEvents ?? []) {
    delete mergedEvents[ev];
  }

  const next: Record<string, unknown> = {
    ...existing,
    ...(Object.keys(mergedEvents).length > 0 ? { events: mergedEvents } : {}),
    ...(parsed.data.brokerIds !== undefined
      ? { brokerIds: parsed.data.brokerIds }
      : {}),
    ...(parsed.data.muted !== undefined ? { muted: parsed.data.muted } : {}),
  };
  if (Object.keys(mergedEvents).length === 0) delete next.events;

  await prisma.deal.update({
    where: { id: deal.id },
    data: { notificationsJson: next as Prisma.InputJsonValue },
  });

  waitUntil(
    audit(extractAuditContextFromRequest(req, org.id, userId), {
      action: "DEAL_NOTIFICATION_OVERRIDE_UPDATED",
      result: "SUCCESS",
      resource: deal.id,
      resourceType: "Deal",
      metadata: {
        eventsPatched: parsed.data.events
          ? Object.keys(parsed.data.events)
          : undefined,
        clearedEvents: parsed.data.clearEvents,
        brokerIdsCount: parsed.data.brokerIds?.length,
        muted: parsed.data.muted,
      },
    })
  );

  const resolved = await resolveEffectiveNotificationConfig(org.id, next);
  return NextResponse.json({ overrides: next, resolved });
}
