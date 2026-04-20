import { NextResponse } from "next/server";
import { auth, getUserOrg } from "./auth";

export interface AuthContext {
  userId: string;
  userEmail: string;
  userName: string;
  orgId: string;
  orgName: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export type AuthResult =
  | { ok: true; ctx: AuthContext }
  | { ok: false; response: NextResponse };

function extractIpAddress(req: Request): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null
  );
}

export async function requireAuth(req: Request): Promise<AuthResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const org = await getUserOrg(session.user.id);
  if (!org) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No organization" },
        { status: 400 }
      ),
    };
  }

  return {
    ok: true,
    ctx: {
      userId: session.user.id,
      userEmail: session.user.email ?? "",
      userName: session.user.name ?? session.user.email ?? "Usuário",
      orgId: org.id,
      orgName: org.name,
      ipAddress: extractIpAddress(req),
      userAgent: req.headers.get("user-agent"),
    },
  };
}
