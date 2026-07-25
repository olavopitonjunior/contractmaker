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
import {
  USER_NOTIF_CATEGORIES,
  type UserNotifCategory,
  type UserNotificationPrefsJson,
} from "@/lib/notifications/user-channels-shared";

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
    // Kill switch do canal WhatsApp → USUÁRIOS da plataforma. Só DESLIGA: quem
    // liga é cada usuário no próprio perfil (opt-in com consentimento datado).
    // Chave ausente = "não interfere"; `false` = bloqueia.
    // A UI manda boolean (o toggle precisa poder DESFAZER o bloqueio), mas o
    // que persiste é só a divergência: `true` remove a chave em vez de gravar.
    // Assim o JSON salvo nunca contém `true` e ninguém lê o blob e conclui
    // que a org consegue LIGAR o canal por um usuário — ela só desliga.
    userChannels: z
      .object({
        enabled: z.boolean().optional(),
        events: z
          .object(
            Object.fromEntries(
              USER_NOTIF_CATEGORIES.map((c) => [c, z.boolean().optional()])
            ) as Record<UserNotifCategory, z.ZodOptional<z.ZodBoolean>>
          )
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    // Destinatários ESCOLHIDOS pelo admin, por categoria. Ao contrário do
    // `userChannels` acima, este bloco **LIGA** o canal — é a exceção
    // deliberada à regra "a org só desliga", decidida porque há quem precise
    // saber de tudo sem ser dono de negócio nenhum (a negociadora).
    //
    // O preço é registrado, não escondido: habilitar por aqui grava
    // `enabledBy` na preferência da pessoa, pra que ninguém leia um
    // `whatsappOptInAt` e conclua que ela mesma consentiu. E ela continua
    // podendo desligar no próprio perfil — o admin liga, o usuário desliga.
    //
    // Lista completa por categoria (substitui, não soma): a UI é uma
    // multi-seleção e manda o estado final.
    userRecipients: z
      .object({
        events: z
          .object(
            Object.fromEntries(
              USER_NOTIF_CATEGORIES.map((c) => [
                c,
                z.array(z.string().min(1)).max(20).optional(),
              ])
            ) as Record<
              UserNotifCategory,
              z.ZodOptional<z.ZodArray<z.ZodString>>
            >
          )
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * Funde o kill switch preservando o que não veio no PATCH, e grava SÓ as
 * divergências: `true` (= "não bloqueia") remove a chave em vez de persistir,
 * mantendo a invariante de que a org só desliga. Ausência ≡ liberado.
 */
function mergeUserChannels(
  current: unknown,
  patch: { enabled?: boolean; events?: Record<string, boolean | undefined> }
): Record<string, unknown> {
  const cur =
    (current as { enabled?: boolean; events?: Record<string, boolean> }) ?? {};
  const next: Record<string, unknown> = { ...cur };

  if (patch.enabled !== undefined) {
    if (patch.enabled) delete next.enabled;
    else next.enabled = false;
  }

  if (patch.events !== undefined) {
    const events: Record<string, boolean> = { ...(cur.events ?? {}) };
    for (const [category, blocked] of Object.entries(patch.events)) {
      if (blocked === undefined) continue;
      if (blocked) delete events[category];
      else events[category] = false;
    }
    if (Object.keys(events).length > 0) next.events = events;
    else delete next.events;
  }

  return next;
}

/**
 * Habilita o canal WhatsApp de uma categoria em nome de quem o admin escolheu.
 *
 * Sem isto, marcar alguém na lista não faria nada: `filterUsersOptedIn` exige
 * `whatsappOptInAt` datado E o toggle da categoria ligado. Ou seja, a escolha
 * do admin precisa materializar a preferência — senão vira silêncio, que é
 * exatamente o modo de falha que já custou caro neste fluxo.
 *
 * `enabledBy` é o que mantém o registro honesto: a linha diz quem ligou e
 * quando, então `whatsappOptInAt` deixa de sugerir consentimento próprio.
 *
 * Idempotente: quem já está ligado não é tocado (não re-carimba o opt-in dela).
 */
async function enableChannelFor(params: {
  userIds: string[];
  orgId: string;
  category: UserNotifCategory;
  byUserId: string;
}): Promise<void> {
  const { userIds, orgId, category, byUserId } = params;
  const at = new Date();
  for (const userId of userIds) {
    const existing = await prisma.userNotificationPreference.findUnique({
      where: { userId_orgId: { userId, orgId } },
      select: { settingsJson: true, whatsappOptInAt: true },
    });
    const prefs =
      (existing?.settingsJson as UserNotificationPrefsJson | null) ?? {};
    if (prefs.events?.[category]?.whatsapp === true && existing?.whatsappOptInAt) {
      continue; // já recebe — não mexe no consentimento existente
    }
    const nextPrefs: UserNotificationPrefsJson = {
      ...prefs,
      events: {
        ...(prefs.events ?? {}),
        [category]: { ...(prefs.events?.[category] ?? {}), whatsapp: true },
      },
      enabledBy: {
        ...(prefs.enabledBy ?? {}),
        [category]: { byUserId, at: at.toISOString() },
      },
    };
    await prisma.userNotificationPreference.upsert({
      where: { userId_orgId: { userId, orgId } },
      create: {
        userId,
        orgId,
        settingsJson: nextPrefs as Prisma.InputJsonValue,
        whatsappOptInAt: at,
      },
      update: {
        settingsJson: nextPrefs as Prisma.InputJsonValue,
        ...(existing?.whatsappOptInAt ? {} : { whatsappOptInAt: at }),
      },
    });
  }
}

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

  // Candidatos pra multi-seleção de "quem mais recebe". `hasPhone` é o que
  // permite a UI avisar ANTES: marcar quem não tem telefone não produz efeito
  // nenhum, e sem esse sinal o admin não teria como saber.
  // Devolve só o booleano — o telefone é PII e não precisa trafegar.
  const membros = await prisma.orgMembership.findMany({
    where: { orgId: ctx.orgId },
    select: {
      userId: true,
      role: true,
      user: { select: { name: true, email: true, phone: true, deletedAt: true } },
    },
    orderBy: { invitedAt: "asc" },
  });
  const recipientCandidates = membros
    .filter((m) => !m.user?.deletedAt)
    .map((m) => ({
      userId: m.userId,
      name: m.user?.name ?? null,
      email: m.user?.email ?? null,
      role: m.role,
      hasPhone: Boolean(m.user?.phone),
    }));

  return NextResponse.json({ settings, resolved, recipientCandidates });
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
  // Destinatários escolhidos: valida ANTES de gravar. Marcar quem não é membro
  // ou não tem telefone falharia em silêncio no sweep — o admin marcaria e nada
  // aconteceria, sem nunca saber por quê.
  let mergedRecipients: Record<string, unknown> | undefined;
  const toEnable: Array<{ category: UserNotifCategory; userIds: string[] }> = [];
  if (parsed.data.userRecipients?.events !== undefined) {
    const pedidos = parsed.data.userRecipients.events;
    const todos = [
      ...new Set(Object.values(pedidos).flatMap((l) => l ?? [])),
    ];

    if (todos.length > 0) {
      const membros = await prisma.orgMembership.findMany({
        where: { orgId: ctx.orgId, userId: { in: todos } },
        select: {
          userId: true,
          user: { select: { name: true, phone: true, deletedAt: true } },
        },
      });
      const porId = new Map(membros.map((m) => [m.userId, m]));

      const naoMembros = todos.filter(
        (id) => !porId.has(id) || porId.get(id)!.user?.deletedAt
      );
      if (naoMembros.length > 0) {
        return NextResponse.json(
          {
            error: "Usuário não é membro ativo desta imobiliária",
            userIds: naoMembros,
          },
          { status: 422 }
        );
      }

      const semTelefone = todos.filter((id) => !porId.get(id)!.user?.phone);
      if (semTelefone.length > 0) {
        return NextResponse.json(
          {
            error:
              "Sem telefone cadastrado não é possível receber por WhatsApp. A pessoa precisa preencher o telefone no próprio perfil.",
            userIds: semTelefone,
            nomes: semTelefone.map((id) => porId.get(id)!.user?.name ?? id),
          },
          { status: 422 }
        );
      }
    }

    const curRecipients =
      ((current.userRecipients as { events?: Record<string, string[]> } | undefined)
        ?.events) ?? {};
    const nextEvents: Record<string, string[]> = { ...curRecipients };
    for (const [category, lista] of Object.entries(pedidos)) {
      if (lista === undefined) continue;
      const antes = new Set(curRecipients[category] ?? []);
      const depois = [...new Set(lista)];
      if (depois.length > 0) nextEvents[category] = depois;
      else delete nextEvents[category];
      // Só os NOVOS têm o canal habilitado. Quem sai da lista NÃO é desligado:
      // pode ter um opt-in próprio anterior, e apagá-lo seria desfazer uma
      // escolha que não é do admin.
      const novos = depois.filter((id) => !antes.has(id));
      if (novos.length > 0) {
        toEnable.push({ category: category as UserNotifCategory, userIds: novos });
      }
    }
    mergedRecipients =
      Object.keys(nextEvents).length > 0 ? { events: nextEvents } : {};
  }

  const next = {
    ...current,
    ...(mergedEvents !== undefined ? { events: mergedEvents } : {}),
    ...(mergedRecipients !== undefined ? { userRecipients: mergedRecipients } : {}),
    ...(parsed.data.formReminder !== undefined
      ? {
          formReminder: {
            ...((current.formReminder as object | undefined) ?? {}),
            ...parsed.data.formReminder,
          },
        }
      : {}),
    ...(parsed.data.userChannels !== undefined
      ? { userChannels: mergeUserChannels(current.userChannels, parsed.data.userChannels) }
      : {}),
  };

  const updated = await prisma.orgNotificationSettings.update({
    where: { orgId: ctx.orgId },
    data: { settingsJson: next as Prisma.InputJsonValue },
  });

  // Depois de gravar a lista, materializa a preferência de quem entrou — senão
  // a escolha do admin não produz efeito nenhum.
  for (const { category, userIds } of toEnable) {
    await enableChannelFor({
      userIds,
      orgId: ctx.orgId,
      category,
      byUserId: ctx.userId,
    });
  }

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
        // Quem foi habilitado por decisão do admin, e em qual categoria. É a
        // trilha que responde "quem ligou o WhatsApp dessa pessoa?".
        canalHabilitadoPara: toEnable.length > 0 ? toEnable : undefined,
      },
    }
  );

  const resolved = await resolveEffectiveNotificationConfig(ctx.orgId);
  return NextResponse.json({ settings: updated, resolved });
}
