import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { requireElevation, ElevationRequiredError } from "@/lib/security/elevation";
import { canGrantRole } from "@/lib/auth/invitations";
import { audit } from "@/lib/security/audit";
import { sendEmail } from "@/lib/email/client";
import { WelcomeSetPasswordEmail } from "@/lib/email/templates/password-reset";
import { generateSecureToken } from "@/lib/security/crypto";
import { createPasswordResetToken } from "@/lib/auth/password-reset";
// MemberInvitedEmail é importado dinamicamente abaixo (só no caminho de user existente).

const ROLE_VALUES = [
  "admin",
  "finance",
  "sales",
  "gerente",
  "viewer",
  "custom",
] as const;

const inviteSchema = z
  .object({
    email: z.string().email().max(200),
    role: z.enum(ROLE_VALUES),
    customRoleId: z.string().optional(),
    name: z.string().optional(),
  })
  .refine((d) => d.role !== "custom" || !!d.customRoleId, {
    message: "customRoleId obrigatório quando role=custom",
    path: ["customRoleId"],
  });

/**
 * GET /api/org/members — lista membros da org.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const members = await prisma.orgMembership.findMany({
    where: { orgId: ctx.orgId },
    include: {
      user: { select: { id: true, name: true, email: true, image: true } },
      customRole: { select: { id: true, name: true } },
    },
    orderBy: { invitedAt: "asc" },
  });

  return NextResponse.json({
    members: members.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      customRoleId: m.customRoleId,
      customRoleName: m.customRole?.name ?? null,
      invitedAt: m.invitedAt,
      lastActiveAt: m.lastActiveAt,
      user: m.user,
    })),
  });
}

/**
 * POST /api/org/members — convida novo membro (cria user + membership).
 * Exige elevation MEMBER_MANAGE + permission org.members.invite.
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.ORG_MEMBERS_INVITE,
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

  const raw = await req.json().catch(() => ({}));
  const parsed = inviteSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }
  const email = parsed.data.email.toLowerCase().trim();
  const { role, customRoleId: customRoleIdRaw, name } = parsed.data;

  // Normaliza na origem para que validação, teto e escrita vejam o MESMO valor.
  // Dois defeitos morrem aqui: (a) `customRoleId: ""` com `role` não-custom
  // gravava string vazia em vez de `NULL`; (b) `{ role: "admin", customRoleId:
  // "<id válido> }` passava no zod (o `.refine` exige o id quando role é
  // custom, mas não o proíbe quando não é) e gravava membership com `role` e
  // `customRoleId` simultâneos — dado que contradiz qualquer código a jusante
  // que assuma "customRoleId implica role custom". Ignorar o id sobrando é
  // menos hostil que 400: o efeito pretendido pelo cliente já é o papel fixo.
  const customRoleId = role === "custom" ? (customRoleIdRaw ?? null) : null;

  // Ordem importa: validar o papel ANTES de qualquer escrita. Estas duas
  // checagens ficavam depois do `user.create` — um 400/403 aqui deixava para
  // trás um `User` órfão com senha placeholder, conta criada para um acesso que
  // nunca foi concedido.
  if (customRoleId) {
    const customRole = await prisma.customRole.findFirst({
      where: { id: customRoleId, orgId: ctx.orgId },
      select: { id: true },
    });
    if (!customRole) {
      return NextResponse.json(
        { error: "Role customizado inválido" },
        { status: 400 }
      );
    }
  }

  // Teto de papel: ninguém concede papel mais poderoso que o próprio. Sem isto
  // a rota era escalação em UMA chamada — `ORG_MEMBERS_INVITE` bastava para
  // criar um `admin` (issue #452), sem nunca ter tido `org.members.change_role`.
  // O `requireElevation` acima não segura nada: é no-op deliberado.
  //
  // Vence o 409 de "já é membro" quando as duas condições coexistem, e isso é
  // decisão: negar antes de contar. A alternativa dava ao ator sem teto uma
  // resposta que confirma quem já pertence à org.
  //
  // Depois do 400 de propósito: customRoleId inexistente ou de outra org é
  // requisição inválida, e responder "você não pode conceder esse papel" para
  // um id que não existe manda o operador caçar problema de permissão onde há
  // erro de digitação.
  const ceiling = await canGrantRole({
    userId: ctx.userId,
    orgId: ctx.orgId,
    targetRole: role,
    targetCustomRoleId: customRoleId ?? null,
  });
  if (!ceiling.allowed) {
    return NextResponse.json(
      {
        error: `Você não pode conceder o papel "${role}" — ele tem permissões que você não possui`,
      },
      { status: 403 }
    );
  }

  // Detecta se é user novo para enviar fluxo de welcome (definir senha)
  // ou apenas notificação de adição (user já tinha conta).
  const existingUser = await prisma.user.findUnique({ where: { email } });
  const isNewUser = !existingUser;

  let user = existingUser;
  if (!user) {
    // Cria user com senha aleatória (placeholder — define a real via link welcome).
    const placeholderPassword = generateSecureToken(32);
    const passwordHash = await bcrypt.hash(placeholderPassword, 10);
    user = await prisma.user.create({
      data: { email, name: name?.trim() || null, passwordHash },
    });
  }

  // Checa se já é membro
  const existingMembership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: user.id, orgId: ctx.orgId } },
  });
  if (existingMembership) {
    return NextResponse.json(
      { error: "Este usuário já é membro da organização" },
      { status: 409 }
    );
  }

  const membership = await prisma.orgMembership.create({
    data: {
      userId: user.id,
      orgId: ctx.orgId,
      role,
      customRoleId: customRoleId ?? null,
      // O humano REAL: sob impersonação `ctx.userId` é o dono do tenant, não
      // quem agiu. Mesma correção que o PR #447 fez em `invitedById`/
      // `approvedById` na tabela irmã — as duas discordarem sobre quem agiu é
      // pior que qualquer uma das duas errada sozinha.
      invitedBy: ctx.impersonatedByUserId ?? ctx.userId,
    },
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    {
      action: "MEMBER_INVITED",
      result: "SUCCESS",
      resourceType: "org_membership",
      resource: `org_membership:${membership.id}`,
      metadata: { invitedUserId: user.id, role },
    }
  );

  // Envia email apropriado: welcome (definir senha) p/ user novo,
  // notificação simples p/ user existente (já tem login).
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

  if (isNewUser) {
    const { token } = await createPasswordResetToken(email, "welcome");
    const setupUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await sendEmail({
      to: email,
      subject: `Bem-vindo a ${ctx.orgName}`,
      react: WelcomeSetPasswordEmail({
        inviterName: ctx.userName,
        orgName: ctx.orgName,
        setupUrl,
      }) as any,
      orgId: ctx.orgId,
    });
  } else {
    const { MemberInvitedEmail } = await import(
      "@/lib/email/templates/member-invited"
    );
    const acceptUrl = `${baseUrl}/login?email=${encodeURIComponent(email)}`;
    await sendEmail({
      to: email,
      subject: `Você foi adicionado a ${ctx.orgName}`,
      react: MemberInvitedEmail({
        inviterName: ctx.userName,
        orgName: ctx.orgName,
        role,
        acceptUrl,
      }) as any,
      orgId: ctx.orgId,
    });
  }

  return NextResponse.json({
    membership: {
      id: membership.id,
      userId: user.id,
      role: membership.role,
      email,
    },
  });
}
