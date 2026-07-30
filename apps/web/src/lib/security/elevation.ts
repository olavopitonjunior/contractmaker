import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/db/prisma";
import { getImpersonationAuditMeta } from "@/lib/auth/impersonation";

export type ElevationScope =
  | "TRANSFER"
  | "KYC_EDIT"
  | "BANK_ACCOUNT"
  | "BANK_ACCOUNT_SWITCH"
  | "API_KEY_ROTATE"
  | "MEMBER_MANAGE"
  | "FEES_CONFIG";

const COOKIE_NAME = "cm_sudo_token";
const ELEVATION_TTL_MS = 15 * 60 * 1000; // 15min

function getSecret(): Uint8Array {
  const raw = process.env.SUDO_TOKEN_SECRET;
  if (!raw) throw new Error("SUDO_TOKEN_SECRET ausente");
  return new TextEncoder().encode(raw);
}

export interface ElevationPayload {
  userId: string;
  scopes: ElevationScope[];
  ip?: string;
  ua?: string;
}

async function signElevation(payload: ElevationPayload): Promise<string> {
  const exp = Math.floor((Date.now() + ELEVATION_TTL_MS) / 1000);
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(getSecret());
}

export async function verifyElevationToken(
  token: string
): Promise<ElevationPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return {
      userId: payload.userId as string,
      scopes: (payload.scopes as ElevationScope[]) ?? [],
      ip: payload.ip as string | undefined,
      ua: payload.ua as string | undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Cria token de elevação e persiste em SessionElevation para audit + revogação.
 * Também seta cookie HttpOnly.
 */
export async function createElevation(params: {
  userId: string;
  scopes: ElevationScope[];
  ip?: string | null;
  ua?: string | null;
}): Promise<{ token: string; expiresAt: Date }> {
  const { userId, scopes, ip, ua } = params;
  const expiresAt = new Date(Date.now() + ELEVATION_TTL_MS);

  const token = await signElevation({
    userId,
    scopes,
    ip: ip ?? undefined,
    ua: ua ?? undefined,
  });

  await prisma.sessionElevation.createMany({
    data: scopes.map((scope) => ({
      userId,
      scope,
      expiresAt,
      ipAddress: ip ?? null,
      userAgent: ua ? ua.slice(0, 1000) : null,
    })),
  });

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: Math.floor(ELEVATION_TTL_MS / 1000),
  });

  return { token, expiresAt };
}

export async function revokeElevation(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

/**
 * Lê a elevation atual do cookie. Retorna null se ausente, expirada ou inválida.
 */
export async function readElevation(): Promise<ElevationPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyElevationToken(token);
}

/**
 * Valida que há elevation ativa para o scope dado. Lança erro para ser capturado
 * pelo handler da rota.
 *
 * DESATIVADO (2026-07-30, decisão do Olavo): a confirmação de identidade
 * (senha + 2FA a cada 15min) foi removida de TODAS as operações — a exigência
 * atrapalhava a operação e a proteção primária continua sendo o RBAC
 * (requirePermission) + sessão autenticada + audit. A função vira no-op no
 * ponto único que todos os ~14 call sites (transfers, KYC, contas bancárias,
 * membros, custom roles, fees, gerentes) importam — nada mais dispara
 * ELEVATION_REQUIRED, então os ElevationDialog do client simplesmente nunca
 * abrem. Toda a infraestrutura (createElevation, cookie, SessionElevation,
 * /api/security) fica intacta: religar = restaurar o corpo original deste
 * função (git log deste arquivo).
 */
export async function requireElevation(
  _userId: string,
  _scope: ElevationScope
): Promise<void> {
  return;
}

/** Corpo original preservado pra religar sem arqueologia de git. */
export async function requireElevationEnforced(
  userId: string,
  scope: ElevationScope
): Promise<void> {
  const payload = await readElevation();
  if (!payload) {
    throw new ElevationRequiredError(scope);
  }
  if (payload.userId !== userId) {
    // Impersonation de tenant: `userId` aqui é o ator EFETIVO (dono do tenant),
    // mas quem passou pelo 2FA foi o super_admin — a elevação é emitida em
    // /api/security, superfície crua (RAW_PATH_PREFIXES), então o JWT leva o id
    // real dele. Sem esta exceção o admin ficava em loop: elevava e a rota
    // sensível continuava negando (o dono nunca elevou nada).
    const imp = await getImpersonationAuditMeta().catch(() => null);
    if (!imp || payload.userId !== imp.adminUserId) {
      throw new ElevationRequiredError(scope);
    }
  }
  if (!payload.scopes.includes(scope)) {
    throw new ElevationRequiredError(scope);
  }
}

export class ElevationRequiredError extends Error {
  scope: ElevationScope;
  status = 403;
  code = "ELEVATION_REQUIRED";

  constructor(scope: ElevationScope) {
    super(`Elevation required for scope ${scope}`);
    this.name = "ElevationRequiredError";
    this.scope = scope;
  }
}
