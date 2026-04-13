import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { executeToolHandler } from "@/lib/ai/tool-handlers";
import type { AgentContext } from "@/lib/ai/types";

/**
 * Debug endpoint — lets the user test the knowledge base search from /settings/knowledge-base
 * without invoking the full agent loop.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const query = typeof body.query === "string" ? body.query : "";
  const category = typeof body.category === "string" ? body.category : undefined;
  const topK = typeof body.topK === "number" ? body.topK : 5;

  if (!query) {
    return NextResponse.json({ error: "query obrigatória" }, { status: 400 });
  }

  // Minimal context shim — the handler only reads orgId
  const context: AgentContext = {
    contractId: "",
    userId: session.user.id,
    orgId: org.id,
    htmlContent: "",
    dataJson: {},
    templateSource: "",
    templateModalidade: "",
    templateName: "",
    activeClauses: [],
  };

  const result = await executeToolHandler(
    "query_knowledge_base",
    { query, category, topK },
    context
  );

  return NextResponse.json(result);
}
