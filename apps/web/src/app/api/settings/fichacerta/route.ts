import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import { requireFichaCertaAdmin } from "@/lib/fichacerta/settings-guard";
import {
  connectFichaCertaAccount,
  disconnectFichaCertaAccount,
  FichaCertaConnectError,
} from "@/lib/fichacerta/connect";
import {
  FICHACERTA_DEFAULT_BASE_URL,
  FICHACERTA_STAGE_BASE_URL,
  parseProducts,
  tokenUrlForSlug,
  webhookUrlForSlug,
} from "@/lib/fichacerta/account";

export const runtime = "nodejs";

const connectSchema = z.object({
  login: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(500),
  environment: z.enum(["producao", "homologacao"]).optional(),
  label: z.string().trim().max(120).optional(),
  // "1,9" — ids de produto (só dígitos e vírgulas).
  products: z
    .string()
    .trim()
    .regex(/^[0-9]+(,[0-9]+)*$/, "Produtos: ids separados por vírgula")
    .optional(),
  costCents: z.number().int().min(0).max(1_000_000).optional(),
});

/** GET — status da conexão Ficha Certa da org (mascarado: nunca devolve senha/segredos). */
export async function GET() {
  const gate = await requireFichaCertaAdmin();
  if (!gate.ok) return gate.response;
  const { orgId } = gate.ctx;

  const account = await prisma.fichaCertaAccount.findUnique({ where: { orgId } });
  return NextResponse.json({
    connected: account?.status === "connected",
    status: account?.status ?? "disconnected",
    label: account?.label ?? null,
    login: account?.login ?? null,
    baseUrl: account?.baseUrl ?? null,
    environment: account
      ? account.baseUrl.startsWith(FICHACERTA_STAGE_BASE_URL)
        ? "homologacao"
        : "producao"
      : null,
    products: account ? parseProducts(account.products) : null,
    costCents: account?.costCents ?? null,
    webhookUrl: account ? webhookUrlForSlug(account.webhookSlug) : null,
    tokenUrl: account ? tokenUrlForSlug(account.webhookSlug) : null,
    webhookProvisioned: account?.webhookProvisioned ?? false,
    lastValidatedAt: account?.lastValidatedAt ?? null,
    lastError: account?.lastError ?? null,
  });
}

/** POST — conecta/reconecta (valida credencial + provisiona webhook + cifra). */
export async function POST(req: NextRequest) {
  const gate = await requireFichaCertaAdmin();
  if (!gate.ok) return gate.response;
  const { orgId, userId } = gate.ctx;

  const body = await req.json().catch(() => ({}));
  const parsed = connectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const baseUrl =
    parsed.data.environment === "homologacao" ? FICHACERTA_STAGE_BASE_URL : FICHACERTA_DEFAULT_BASE_URL;

  try {
    const result = await connectFichaCertaAccount({
      orgId,
      userId,
      login: parsed.data.login,
      password: parsed.data.password,
      baseUrl,
      label: parsed.data.label,
      products: parsed.data.products,
      costCents: parsed.data.costCents,
    });
    await audit(
      { orgId, userId },
      {
        action: "CREDIT_ACCOUNT_CONNECTED",
        result: "SUCCESS",
        resourceType: "FichaCertaAccount",
        metadata: {
          provider: "fichacerta",
          environment: parsed.data.environment ?? "producao",
          webhookProvisioned: result.webhookProvisioned,
          products: result.products,
        },
      }
    ).catch(() => {});
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof FichaCertaConnectError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[fichacerta connect] erro:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** DELETE — desconecta (remove webhook remoto best-effort + apaga a conta). */
export async function DELETE() {
  const gate = await requireFichaCertaAdmin();
  if (!gate.ok) return gate.response;
  const { orgId, userId } = gate.ctx;

  const result = await disconnectFichaCertaAccount(orgId);
  if (!result.alreadyDisconnected) {
    await audit(
      { orgId, userId },
      {
        action: "CREDIT_ACCOUNT_DISCONNECTED",
        result: "SUCCESS",
        resourceType: "FichaCertaAccount",
        metadata: { provider: "fichacerta" },
      }
    ).catch(() => {});
  }
  return NextResponse.json(result);
}
