import crypto from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { sha256Hex } from "./crypto";

const COOKIE_NAME = "cm_trusted_device";
const DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d

export function computeFingerprint(parts: {
  userAgent: string;
  platform?: string;
  language?: string;
  screenColorDepth?: number;
}): string {
  const raw = [
    parts.userAgent ?? "",
    parts.platform ?? "",
    parts.language ?? "",
    parts.screenColorDepth ?? "",
  ].join("|");
  return sha256Hex(raw);
}

interface DeviceCookiePayload {
  fp: string;
  uid: string;
  exp: number;
}

function getSecret(): Buffer {
  const raw = process.env.TRUSTED_DEVICE_SECRET;
  if (!raw) throw new Error("TRUSTED_DEVICE_SECRET ausente");
  return Buffer.from(raw, "hex");
}

function signCookie(payload: DeviceCookiePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto
    .createHmac("sha256", getSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${mac}`;
}

function verifyCookie(cookieValue: string): DeviceCookiePayload | null {
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return null;
  const [body, mac] = parts;
  const expected = crypto
    .createHmac("sha256", getSecret())
    .update(body)
    .digest("base64url");
  if (
    mac.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))
  ) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8")
    ) as DeviceCookiePayload;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function trustDevice(params: {
  userId: string;
  orgId: string;
  fingerprint: string;
  label?: string | null;
  ip?: string | null;
}): Promise<void> {
  await prisma.trustedDevice.upsert({
    where: {
      userId_fingerprint: {
        userId: params.userId,
        fingerprint: params.fingerprint,
      },
    },
    create: {
      userId: params.userId,
      orgId: params.orgId,
      fingerprint: params.fingerprint,
      label: params.label ?? null,
      lastIpAddress: params.ip ?? null,
      lastSeenAt: new Date(),
    },
    update: {
      lastSeenAt: new Date(),
      lastIpAddress: params.ip ?? null,
      revokedAt: null,
    },
  });

  const cookieStore = await cookies();
  const payload: DeviceCookiePayload = {
    fp: params.fingerprint,
    uid: params.userId,
    exp: Date.now() + DEVICE_TTL_MS,
  };
  cookieStore.set(COOKIE_NAME, signCookie(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: Math.floor(DEVICE_TTL_MS / 1000),
  });
}

export async function isCurrentDeviceTrusted(userId: string): Promise<boolean> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME)?.value;
  if (!cookie) return false;
  const payload = verifyCookie(cookie);
  if (!payload) return false;
  if (payload.uid !== userId) return false;

  const device = await prisma.trustedDevice.findUnique({
    where: {
      userId_fingerprint: { userId, fingerprint: payload.fp },
    },
  });
  if (!device || device.revokedAt) return false;
  return true;
}

export async function revokeDevice(deviceId: string, userId: string): Promise<void> {
  await prisma.trustedDevice.updateMany({
    where: { id: deviceId, userId },
    data: { revokedAt: new Date() },
  });
}

export async function listTrustedDevices(userId: string) {
  return prisma.trustedDevice.findMany({
    where: { userId, revokedAt: null },
    orderBy: { lastSeenAt: "desc" },
  });
}
