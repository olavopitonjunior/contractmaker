import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { generateInsights, type InsightContext } from "@/lib/ai/insights-generator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const insightsSchema = z.object({
  context: z.enum(["dashboard", "contract", "property", "cashflow"]),
  contextId: z.string().optional(),
});

/**
 * POST /api/ai/insights — gera 1-3 observações contextuais via Anthropic Haiku.
 * Cache 30min Upstash. Fallback heurístico se sem ANTHROPIC_API_KEY.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ insights: [] });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = insightsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const insights = await generateInsights({
    orgId: org.id,
    userId: session.user.id,
    context: parsed.data.context as InsightContext,
    contextId: parsed.data.contextId,
  });

  return NextResponse.json({ insights });
}
