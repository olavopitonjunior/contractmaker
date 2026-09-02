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
import type { RolePreset } from "@/lib/security/rbac/roles";
import { requireElevation, ElevationRequiredError } from "@/lib/security/elevation";
import { canGrantRole } from "@/lib/auth/invitations";
import { audit } from "@/lib/security/audit";

/**
 * `satisfies readonly RolePreset[]` é a guarda da vacuidade do teto, não
 * enfeite de tipagem: `resolveTargetPermissions` devolve `{}` — que passa o
 * teste de subconjunto VACUAMENTE — para papel que não seja chave de
 * `ROLE_PRESETS`. Hoje nenhum valor daqui cai nesse caso, e é o `tsc` que passa
 * a garantir isso: acrescentar aqui um papel que não seja preset conhecido
 * quebra o typecheck nesta linha, em vez de virar "teto que libera tudo" em
 * produção. Este arquivo mantém cópia própria do enum (não deriva de
 * `roles.ts`), então sem a guarda nada ligava as duas pontas.
 */
const ROLE_VALUES = [
  "admin",
  "finance",
  "sales",
  "gerente",
  "viewer",
  "custom",
] as const satisfies readonly RolePreset[];

const patchSchema = z.object({
  role: z.enum(ROLE_VALUES).optional(),
  customRoleId: z.string().nullable().optional(),
});

async function ensureNotLastAdmin(orgId: string, excludeMembershipId: string) {
  const adminCount = await prisma.orgMembership.count({
    where: {
      orgId,
      role: { in: ["owner", "admin"] },
      id: { not: excludeMembershipId },
    },
  });
  if (adminCount === 0) {
    throw new Error("LAST_ADMIN");
  }
}

/**
 * PATCH /api/org/members/[id] — altera role do membro.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { id: membershipId } = await params;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.ORG_MEMBERS_CHANGE_ROLE,
    });
    await requireElevation(ctx.userId, "MEMBER_MANAGE");
  } catch (err) {
    if (
      err instanceof PermissionDeniedError ||
      err instanceof MembershipRequiredError ||
      err instanceof ElevationRequiredError
    ) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const membership = await prisma.orgMembership.findFirst({
    where: { id: membershipId, orgId: ctx.orgId },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  if (!membership) {
    return NextResponse.json({ error: "Membro não encontrado" }, { status: 404 });
  }
  if (membership.userId === ctx.userId) {
    return NextResponse.json(
      { error: "Você não pode alterar seu próprio papel" },
      { status: 422 }
    );
  }
  if (membership.role === "owner") {
    return NextResponse.json(
      { error: "Use /transfer-ownership para mover o owner" },
      { status: 422 }
    );
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  // Estado RESULTANTE do PATCH, calculado uma vez e usado daqui pra baixo por
  // validação, teto e escrita. Ler o body direto seria insuficiente porque
  // PATCH é parcial: `{ customRoleId: "cr-x" }` SEM `role`, numa membership que
  // já é `custom`, troca o conjunto inteiro de permissões sem que a palavra
  // `role` apareça na requisição. Um teto que olhasse `parsed.data.role`
  // deixaria passar exatamente esse caso.
  const nextRole = parsed.data.role ?? membership.role;
  const nextCustomRoleIdBruto =
    parsed.data.customRoleId === null
      ? null
      : parsed.data.customRoleId ?? membership.customRoleId;
  // Mesma normalização do `POST /api/org/members`: o id só sobrevive quando o
  // papel resultante é `custom`. Sem ela a membership saía com `role` e
  // `customRoleId` simultâneos — `resolvePermissions` ignora o id fora de
  // `custom`, então não é escalação, é dado morto que contradiz todo código a
  // jusante que assuma "customRoleId implica custom".
  const nextCustomRoleId = nextRole === "custom" ? nextCustomRoleIdBruto : null;

  // Fora do ramo `admin` de propósito: era ali que esta checagem vivia, e para
  // owner a rota gravava `role: "custom"` com `customRoleId: null` — membership
  // que `resolvePermissions` resolve como SEM PERMISSÃO NENHUMA. O membro
  // perdia todo o acesso em silêncio, com 200 na resposta.
  if (nextRole === "custom" && !nextCustomRoleId) {
    return NextResponse.json(
      { error: "customRoleId obrigatório quando role=custom" },
      { status: 400 }
    );
  }

  // Admin não pode promover a owner nem alterar role de outro admin
  const actorMembership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: ctx.userId, orgId: ctx.orgId } },
  });
  if (actorMembership?.role === "admin") {
    // Admin NÃO pode rebaixar outro admin (só owner pode)
    if (membership.role === "admin" && ctx.userId !== membership.userId) {
      return NextResponse.json(
        { error: "Apenas o owner pode rebaixar admins" },
        { status: 403 }
      );
    }
  }

  // 400 e não 403, como no `POST /api/org/members`: id inexistente ou de outro
  // tenant é requisição inválida, não falta de permissão — responder "você não
  // pode conceder esse papel" manda o operador caçar problema de permissão onde
  // há erro de digitação. O filtro carrega o `orgId`: sem ele, uma CustomRole de
  // OUTRO tenant viraria alvo válido aqui.
  let rotuloDoAlvo: string = nextRole;
  if (nextCustomRoleId) {
    const customRole = await prisma.customRole.findFirst({
      where: { id: nextCustomRoleId, orgId: ctx.orgId },
      select: { id: true, name: true },
    });
    if (!customRole) {
      return NextResponse.json(
        { error: "Role customizado inválido" },
        { status: 400 }
      );
    }
    rotuloDoAlvo = customRole.name;
  }

  // Teto de papel — o quarto e último caminho da família #452/#473/#474/#488.
  // Os outros três já perguntam se o papel ALVO cabe em quem age; este trocava
  // papel com `ORG_MEMBERS_CHANGE_ROLE` e mais nada (`requireElevation` é no-op
  // deliberado). Hoje essa chave só existe em `owner`/`admin`, que já concedem
  // tudo, então não há escalação na base instalada — mas a tela de papéis deixa
  // criar uma CustomRole com ela, e foi essa a forma exata do bug da #452.
  //
  // `ctx.userId` e não o impersonador, pelo mesmo critério das outras três
  // rotas: sob impersonação quem age DENTRO do tenant é o dono dele, e o
  // operador de plataforma não tem membership nesta org — medir o teto por ele
  // daria o resultado errado.
  //
  // Não trava owner nem admin, e isso foi medido, não suposto: as 13 chaves de
  // `MANAGER_CONFIGURABLE_PERMISSIONS` — as únicas que um override de org pode
  // acrescentar a um preset — estão nos dois. Nem uma org que libere tudo para
  // `gerente` produz alvo fora do teto deles. O teste em
  // `lib/auth/__tests__/teto-overrides-de-gerente.test.ts` prende esse
  // invariante, porque quem acrescentar uma 14ª chave que o admin não tenha
  // quebraria a troca de papel na tela sem tocar em nenhuma destas rotas.
  const ceiling = await canGrantRole({
    userId: ctx.userId,
    orgId: ctx.orgId,
    targetRole: nextRole,
    targetCustomRoleId: nextCustomRoleId,
  });
  if (!ceiling.allowed) {
    // Só esta recusa é auditada, e a assimetria é conhecida, não descuido: as
    // outras três rotas da família negam por teto sem gravar nada, e a recusa
    // vizinha aqui ("admin não rebaixa admin") também não grava. Uniformizar é
    // barato mas mexe em duas rotas que este conserto não precisa tocar — fica
    // para um PR próprio. Auditar a tentativa de escalação onde ela é nova
    // custa uma linha e é o único rastro que existe hoje.
    await audit(
      {
        orgId: ctx.orgId,
        userId: ctx.userId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      {
        action: "MEMBER_ROLE_CHANGE_DENIED",
        result: "DENIED",
        resourceType: "org_membership",
        resource: `org_membership:${membership.id}`,
        metadata: {
          targetUserId: membership.userId,
          previousRole: membership.role,
          attemptedRole: nextRole,
          reason: ceiling.reason,
        },
      }
    );
    // Nomeia a CustomRole e não o enum `custom`: numa org com várias, "o papel
    // custom" não diz qual foi negada. Não nomeia a PERMISSÃO que faltou, de
    // propósito — isso descreveria o conteúdo de um papel a quem não pode
    // concedê-lo, e quem recebe o 403 é exatamente quem não deveria enumerá-lo.
    return NextResponse.json(
      {
        error: `Você não pode conceder o papel "${rotuloDoAlvo}" — ele tem permissões que você não possui`,
      },
      { status: 403 }
    );
  }

  // Se está rebaixando de admin, garante que não é o último
  if (membership.role === "admin" && parsed.data.role && parsed.data.role !== "admin") {
    try {
      await ensureNotLastAdmin(ctx.orgId, membership.id);
    } catch {
      return NextResponse.json(
        { error: "Não é possível rebaixar o último administrador" },
        { status: 422 }
      );
    }
  }

  const updated = await prisma.orgMembership.update({
    where: { id: membership.id },
    data: { role: nextRole, customRoleId: nextCustomRoleId },
  });

  // Dois audit logs: um para quem alterou, outro referenciando o alvo
  await audit(
    { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    {
      action: "MEMBER_ROLE_CHANGED",
      result: "SUCCESS",
      resourceType: "org_membership",
      resource: `org_membership:${updated.id}`,
      metadata: {
        targetUserId: membership.userId,
        previousRole: membership.role,
        newRole: updated.role,
      },
    }
  );
  await audit(
    { orgId: ctx.orgId, userId: membership.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    {
      action: "MEMBER_ROLE_CHANGED_TARGET",
      result: "SUCCESS",
      resourceType: "org_membership",
      resource: `org_membership:${updated.id}`,
      metadata: {
        changedByUserId: ctx.userId,
        previousRole: membership.role,
        newRole: updated.role,
      },
    }
  );

  return NextResponse.json({ membership: updated });
}

/**
 * DELETE /api/org/members/[id] — remove membro.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { id: membershipId } = await params;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.ORG_MEMBERS_REMOVE,
    });
    await requireElevation(ctx.userId, "MEMBER_MANAGE");
  } catch (err) {
    if (
      err instanceof PermissionDeniedError ||
      err instanceof MembershipRequiredError ||
      err instanceof ElevationRequiredError
    ) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const membership = await prisma.orgMembership.findFirst({
    where: { id: membershipId, orgId: ctx.orgId },
  });
  if (!membership) {
    return NextResponse.json({ error: "Membro não encontrado" }, { status: 404 });
  }
  if (membership.userId === ctx.userId) {
    return NextResponse.json(
      {
        error:
          "Você não pode se remover por aqui — use 'Sair da organização'",
      },
      { status: 422 }
    );
  }
  if (membership.role === "owner") {
    return NextResponse.json(
      { error: "Não é possível remover o owner — use transfer-ownership" },
      { status: 422 }
    );
  }

  // Membership de agente, não de gente. O Bearer do agente resolve a org pela
  // membership do dono do token, então remover esta linha derruba o agente
  // naquele tenant — e em silêncio, porque nada falha até a próxima chamada.
  // O caminho de desligar é a feature no painel, que revoga o token e avisa o
  // serviço; aqui só sobraria um agente órfão com credencial válida.
  if (membership.isSystem) {
    return NextResponse.json(
      {
        error:
          "Este é um usuário de serviço de um agente. Desligue o agente nos módulos da organização em vez de remover o membro.",
      },
      { status: 422 }
    );
  }

  // Último admin guard
  if (membership.role === "admin") {
    try {
      await ensureNotLastAdmin(ctx.orgId, membership.id);
    } catch {
      return NextResponse.json(
        { error: "Não é possível remover o último administrador" },
        { status: 422 }
      );
    }
  }

  await prisma.orgMembership.delete({ where: { id: membership.id } });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    {
      action: "MEMBER_REMOVED",
      result: "SUCCESS",
      resourceType: "org_membership",
      resource: `org_membership:${membership.id}`,
      metadata: { targetUserId: membership.userId, role: membership.role },
    }
  );

  return NextResponse.json({ ok: true });
}
