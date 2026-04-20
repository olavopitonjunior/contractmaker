import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/context";
import { confirmChallenge } from "@/lib/security/challenge";
import { audit } from "@/lib/security/audit";

const bodySchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Código deve ter 6 dígitos"),
});

/**
 * POST /api/security/challenges/[id]/confirm
 * Body: { code }
 * Retorna X-Challenge-Token JWT se OK.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const { id } = await params;

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Código inválido" }, { status: 400 });
  }

  const result = await confirmChallenge({
    id,
    userId: ctx.userId,
    code: parsed.data.code,
  });

  if (!result.ok) {
    await audit(
      { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      {
        action: result.reason === "EXPIRED" ? "CHALLENGE_EXPIRED" : "CHALLENGE_FAILED",
        result: "FAILURE",
        resourceType: "operation_challenge",
        resource: `operation_challenge:${id}`,
        metadata: { reason: result.reason },
      }
    );

    const status =
      result.reason === "EXPIRED" ? 410 : result.reason === "MAX_ATTEMPTS" ? 429 : 401;
    return NextResponse.json({ error: result.reason }, { status });
  }

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    {
      action: "CHALLENGE_CONFIRMED",
      result: "SUCCESS",
      resourceType: "operation_challenge",
      resource: `operation_challenge:${id}`,
    }
  );

  return NextResponse.json({ token: result.token });
}
