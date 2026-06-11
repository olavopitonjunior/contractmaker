import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

const KNOWN_CRON_PATHS = new Set<string>([
  "/api/cron/ocr-queue",
  "/api/cron/webhooks/retry-orphaned",
  "/api/cron/google-watches/renew",
  "/api/cron/api-usage/cleanup",
  "/api/cron/intents/expire",
  "/api/cron/charges/due-soon",
  "/api/cron/drafts/cleanup",
  "/api/cron/clicksign/sync-envelopes",
  "/api/cron/agent-runs/cleanup",
  "/api/cron/newton-requests/sweep",
  "/api/cron/newton-requests/group-match",
  "/api/cron/certidoes/poll-portal",
  "/api/cron/certidoes/problem-digest",
  "/api/cron/asaas/transfer-dispatch",
  "/api/cron/locacao/newton/check-late-payments",
  "/api/cron/locacao/newton/check-readjustments",
  "/api/cron/rent/generate",
  "/api/cron/rent/readjust",
]);

const patchSchema = z.object({ enabled: z.boolean() });

/**
 * PUT /api/admin/staging-crons/[path] { enabled: bool }
 * - path é o segmento URL-encoded (ex.: "%2Fapi%2Fcron%2Frent%2Fgenerate").
 * - Owner-only.
 * - Validation: só aceita paths do KNOWN_CRON_PATHS.
 *
 * Em prod a tabela CronToggle existe mas o gate só consulta se STAGING_MODE=true.
 * Mexer em prod via essa UI não tem efeito (crons rodam sempre).
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ path: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "Sem org" }, { status: 404 });

  const membership = await prisma.orgMembership.findFirst({
    where: { orgId: org.id, userId: session.user.id },
    select: { role: true },
  });
  if (membership?.role !== "owner") {
    return NextResponse.json({ error: "Apenas owners" }, { status: 403 });
  }

  const { path: rawPath } = await params;
  const path = decodeURIComponent(rawPath);
  if (!KNOWN_CRON_PATHS.has(path)) {
    return NextResponse.json({ error: "Cron path desconhecido" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  await prisma.cronToggle.upsert({
    where: { path },
    update: { enabled: parsed.data.enabled, updatedBy: session.user.id },
    create: { path, enabled: parsed.data.enabled, updatedBy: session.user.id },
  });

  await audit(
    { orgId: org.id, userId: session.user.id },
    {
      action: "CRON_TOGGLE_UPDATE",
      result: "SUCCESS",
      resource: path,
      resourceType: "CronToggle",
      metadata: { enabled: parsed.data.enabled },
    }
  );

  return NextResponse.json({ path, enabled: parsed.data.enabled });
}
