import { NextRequest, NextResponse } from "next/server";
import { resolvePublicToken } from "@/lib/financeiro/publicPage";
import { RateLimits } from "@/lib/security/ratelimit";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function maskPayerName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return "";
  return parts[0] + (parts.length > 1 ? " " + parts[parts.length - 1][0] + "." : "");
}

function maskCpfCnpj(doc: string): string {
  const digits = doc.replace(/\D/g, "");
  if (digits.length === 11) return `***.***.***-${digits.slice(-2)}`;
  return `**.***.***/****-${digits.slice(-2)}`;
}

/**
 * GET /api/public/charges/[token]
 * Endpoint público — sem auth. Retorna dados mínimos da cobrança + branding.
 * Rate limit 30 req/min/IP.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "anon";
  const rl = await RateLimits.publicPageByIp(ip);
  if (!rl.success) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const link = await resolvePublicToken(token);
  if (!link) {
    return NextResponse.json({ error: "Link inválido" }, { status: 404 });
  }

  const c = link.charge;

  // Se charge cancelada → 410 Gone
  if (c.status === "CANCELLED") {
    return NextResponse.json({ error: "GONE", status: c.status }, { status: 410 });
  }

  // Increment view counter (best-effort, dedup silenciosa)
  prisma.chargePublicLink
    .update({
      where: { id: link.id },
      data: {
        viewCount: { increment: 1 },
        lastViewedAt: new Date(),
      },
    })
    .catch(() => {});

  return NextResponse.json({
    charge: {
      id: c.id,
      value: c.value,
      billingType: c.billingType,
      status: c.status,
      description: c.description,
      currentDueDate: c.currentDueDate,
      paidAt: c.paidAt,
      invoiceUrl: c.invoiceUrl,
      bankSlipUrl: c.bankSlipUrl,
      identificationField: c.identificationField,
      pixQrCodePayload: c.pixQrCodePayload,
      pixQrCodeImage: c.pixQrCodeImage,
    },
    payer: c.customer
      ? {
          firstName: maskPayerName(c.customer.name),
          cpfCnpjMasked: maskCpfCnpj(c.customer.cpfCnpj),
        }
      : null,
    brand: link.brandSnapshot,
  });
}
