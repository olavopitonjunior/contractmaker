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
  isPartyCapableEvent,
  resolveEffectiveNotificationConfig,
  type DealNotifEvent,
} from "@/lib/notifications/deal-events-config";
import {
  USER_NOTIF_CATEGORIES,
  USER_NOTIF_CHANNELS,
  type UserNotifCategory,
  type UserNotifChannel,
  type UserNotificationPrefsJson,
} from "@/lib/notifications/user-channels-shared";
import { USER_CHANNEL_REGISTRY } from "@/lib/notifications/user-channels-registry";

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
  .object({
    broker: channelTogglesSchema.optional(),
    party: channelTogglesSchema.optional(),
  })
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
    // Matriz de avisos internos: por USUÁRIO, por TIPO, por CANAL.
    //
    // Ao contrário do `userChannels` acima, que só desliga, este bloco LIGA —
    // exceção deliberada à regra "a org só desliga", decidida porque há quem
    // precise saber de tudo sem ser dono de negócio nenhum (a negociadora).
    //
    // O preço fica registrado, não escondido: habilitar WhatsApp por aqui grava
    // `enabledBy` na preferência da pessoa, pra que ninguém leia um
    // `whatsappOptInAt` e conclua que ela mesma consentiu. E-mail não passa por
    // esse carimbo — e-mail corporativo é canal de trabalho, não PII pessoal.
    //
    // A pessoa continua podendo desligar no próprio perfil: o admin liga, o
    // usuário desliga.
    userRecipients: z
      .record(
        z.string().min(1), // userId
        z.record(
          z.string().min(1), // type
          z
            .object(
              Object.fromEntries(
                USER_NOTIF_CHANNELS.map((c) => [c, z.boolean().optional()])
              ) as Record<UserNotifChannel, z.ZodOptional<z.ZodBoolean>>
            )
            .strict()
        )
      )
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
 * Materializa na preferência da pessoa o que o admin escolheu.
 *
 * Sem isto, marcar alguém na matriz não faria nada: `filterUsersOptedIn` lê a
 * preferência DELA, não a lista da org. A escolha do admin precisa virar
 * preferência — senão vira silêncio, que é o modo de falha que já custou caro
 * neste fluxo.
 *
 * Assimetria deliberada entre canais:
 *  - **WhatsApp** carimba `whatsappOptInAt` e grava `enabledBy`, pra que
 *    ninguém leia a linha e conclua que ela mesma consentiu. Número é PII.
 *  - **E-mail** não carimba nada: e-mail corporativo é canal de trabalho, e a
 *    org já liga o e-mail de corretor do mesmo jeito.
 *
 * Só sobrescreve os tipos que vieram no PATCH; o resto da preferência dela
 * fica intacto — inclusive um opt-in próprio anterior.
 */
async function applyUserMatrix(params: {
  orgId: string;
  byUserId: string;
  entradas: Array<{
    userId: string;
    porTipo: Record<string, { email?: boolean; whatsapp?: boolean }>;
  }>;
}): Promise<void> {
  const { orgId, byUserId, entradas } = params;
  const at = new Date();

  for (const { userId, porTipo } of entradas) {
    const existing = await prisma.userNotificationPreference.findUnique({
      where: { userId_orgId: { userId, orgId } },
      select: { settingsJson: true, whatsappOptInAt: true },
    });
    const prefs =
      (existing?.settingsJson as UserNotificationPrefsJson | null) ?? {};

    const types = { ...(prefs.types ?? {}) };
    const enabledBy = { ...(prefs.enabledBy ?? {}) };
    let ligouWhatsapp = false;

    for (const [tipo, canais] of Object.entries(porTipo)) {
      types[tipo] = { ...(types[tipo] ?? {}), ...canais };
      if (canais.whatsapp === true) {
        ligouWhatsapp = true;
        const cat = USER_CHANNEL_REGISTRY[tipo]?.category;
        if (cat) enabledBy[cat] = { byUserId, at: at.toISOString() };
      }
    }

    const nextPrefs: UserNotificationPrefsJson = { ...prefs, types, enabledBy };
    await prisma.userNotificationPreference.upsert({
      where: { userId_orgId: { userId, orgId } },
      create: {
        userId,
        orgId,
        settingsJson: nextPrefs as Prisma.InputJsonValue,
        // Só o WhatsApp exige consentimento datado; ligar só e-mail não carimba.
        whatsappOptInAt: ligouWhatsapp ? at : null,
      },
      update: {
        settingsJson: nextPrefs as Prisma.InputJsonValue,
        ...(ligouWhatsapp && !existing?.whatsappOptInAt
          ? { whatsappOptInAt: at }
          : {}),
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

  // Candidatos da matriz. `hasPhone`/`hasEmail` permitem a UI avisar ANTES:
  // marcar um canal sem o contato correspondente não produz efeito nenhum, e
  // sem esse sinal o admin não teria como saber. Devolve só os booleanos — o
  // telefone é PII e não precisa trafegar.
  const membros = await prisma.orgMembership.findMany({
    where: { orgId: ctx.orgId },
    select: {
      userId: true,
      role: true,
      user: { select: { name: true, email: true, phone: true, deletedAt: true } },
    },
    orderBy: { invitedAt: "asc" },
  });
  const vivos = membros.filter((m) => !m.user?.deletedAt);

  // A matriz vive na preferência de cada pessoa (é lá que ela também desliga),
  // então o GET agrega pra UI não precisar de N requisições.
  const prefs = await prisma.userNotificationPreference.findMany({
    where: { orgId: ctx.orgId, userId: { in: vivos.map((m) => m.userId) } },
    select: { userId: true, settingsJson: true },
  });
  const prefsPorUser = new Map(
    prefs.map((p) => [
      p.userId,
      (p.settingsJson as UserNotificationPrefsJson | null)?.types ?? {},
    ])
  );

  const recipientCandidates = vivos.map((m) => ({
    userId: m.userId,
    name: m.user?.name ?? null,
    email: m.user?.email ?? null,
    role: m.role,
    hasPhone: Boolean(m.user?.phone),
    hasEmail: Boolean(m.user?.email),
    types: prefsPorUser.get(m.userId) ?? {},
  }));

  // A estrutura de avisos é da PLATAFORMA (vale pra qualquer imobiliária), mas
  // o transporte de WhatsApp hoje é o Newton, que atende só um tenant. Sem
  // este sinal, um admin de outra imobiliária marcaria WhatsApp e nada
  // aconteceria — o envio viraria `skipped` num log que ele nunca vê.
  //
  // E-mail não depende de agente: funciona pra todo mundo.
  const { isNewtonEnabledForOrg } = await import("@/lib/newton/gate");
  const whatsappAgentAvailable = await isNewtonEnabledForOrg(ctx.orgId).catch(
    () => false
  );

  return NextResponse.json({
    settings,
    resolved,
    recipientCandidates,
    whatsappAgentAvailable,
  });
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
    // Party fora da allowlist é rejeitado no PATCH, não zerado em silêncio: o
    // resolver já ignoraria, mas o admin veria um toggle "salvo" que nunca
    // dispara. (A UI só oferece os eventos válidos; isto pega chamada direta.)
    const foraDaAllowlist = Object.entries(parsed.data.events)
      .filter(([ev, t]) => t?.party && !isPartyCapableEvent(ev as DealNotifEvent))
      .map(([ev]) => ev);
    if (foraDaAllowlist.length > 0) {
      return NextResponse.json(
        {
          error:
            "Este evento não pode ser enviado às partes do negócio.",
          eventos: foraDaAllowlist,
        },
        { status: 422 }
      );
    }

    mergedEvents = { ...currentEvents };
    for (const [ev, toggles] of Object.entries(parsed.data.events)) {
      if (!toggles) continue;
      const curEvent = currentEvents[ev] ?? {};
      const curBroker = (curEvent.broker as Record<string, unknown>) ?? {};
      const curParty = (curEvent.party as Record<string, unknown>) ?? {};
      mergedEvents[ev] = {
        ...curEvent,
        broker: { ...curBroker, ...toggles.broker },
        party: { ...curParty, ...toggles.party },
      };
    }
  }
  // Matriz de avisos internos: valida ANTES de gravar. Marcar quem não é
  // membro, ou marcar um canal sem o contato correspondente, falharia em
  // silêncio no sweep — o admin marcaria e nada aconteceria, sem saber por quê.
  let matrizGravada: Record<string, unknown> | undefined;
  const aplicarPrefs: Array<{
    userId: string;
    porTipo: Record<string, { email?: boolean; whatsapp?: boolean }>;
  }> = [];

  if (parsed.data.userRecipients !== undefined) {
    const matriz = parsed.data.userRecipients;
    const userIds = Object.keys(matriz);

    // Tipo desconhecido é erro, não no-op: um typo silencioso deixaria o admin
    // achando que configurou algo que nunca vai disparar.
    const tiposInvalidos = [
      ...new Set(
        Object.values(matriz).flatMap((porTipo) =>
          Object.keys(porTipo).filter((t) => !USER_CHANNEL_REGISTRY[t])
        )
      ),
    ];
    if (tiposInvalidos.length > 0) {
      return NextResponse.json(
        { error: "Tipo de notificação desconhecido", tipos: tiposInvalidos },
        { status: 400 }
      );
    }

    if (userIds.length > 0) {
      const membros = await prisma.orgMembership.findMany({
        where: { orgId: ctx.orgId, userId: { in: userIds } },
        select: {
          userId: true,
          user: { select: { name: true, phone: true, email: true, deletedAt: true } },
        },
      });
      const porId = new Map(membros.map((m) => [m.userId, m]));

      const naoMembros = userIds.filter(
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

      // A imobiliária tem agente de WhatsApp? A estrutura de avisos é da
      // plataforma, mas o transporte hoje é o Newton, que atende um tenant só.
      // Aceitar a marcação sem agente produziria `skipped` silencioso.
      const querWhatsapp = userIds.some((id) =>
        Object.values(matriz[id]).some((c) => c.whatsapp === true)
      );
      if (querWhatsapp) {
        const { isNewtonEnabledForOrg } = await import("@/lib/newton/gate");
        if (!(await isNewtonEnabledForOrg(ctx.orgId))) {
          return NextResponse.json(
            {
              error:
                "Esta imobiliária ainda não tem agente de WhatsApp habilitado. Os avisos por e-mail funcionam normalmente.",
            },
            { status: 422 }
          );
        }
      }

      // Validação POR CANAL: bloquear e-mail por falta de telefone seria falso,
      // e é justamente quem só usa e-mail que se perderia.
      const semTelefone = userIds.filter(
        (id) =>
          !porId.get(id)!.user?.phone &&
          Object.values(matriz[id]).some((c) => c.whatsapp === true)
      );
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

    // A org guarda só QUEM tem alcance org-wide. O "o quê" e "por qual canal"
    // vivem na preferência da pessoa — que é onde ela também pode desligar.
    const comAlgumCanal = userIds.filter((id) =>
      Object.values(matriz[id]).some((c) => c.email === true || c.whatsapp === true)
    );
    matrizGravada = { users: comAlgumCanal };

    for (const userId of userIds) {
      aplicarPrefs.push({ userId, porTipo: matriz[userId] });
    }
  }

  const next = {
    ...current,
    ...(mergedEvents !== undefined ? { events: mergedEvents } : {}),
    ...(matrizGravada !== undefined ? { userRecipients: matrizGravada } : {}),
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
  if (aplicarPrefs.length > 0) {
    await applyUserMatrix({
      orgId: ctx.orgId,
      byUserId: ctx.userId,
      entradas: aplicarPrefs,
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
        // Trilha que responde "quem ligou o aviso dessa pessoa?".
        matrizAplicadaPara:
          aplicarPrefs.length > 0 ? aplicarPrefs.map((e) => e.userId) : undefined,
      },
    }
  );

  const resolved = await resolveEffectiveNotificationConfig(ctx.orgId);
  return NextResponse.json({ settings: updated, resolved });
}
