import { NextRequest, NextResponse } from "next/server";
import { authOrBearer, hasScope } from "@/lib/auth/auth-or-bearer";
import { prisma } from "@/lib/db/prisma";

/**
 * GET /api/attachments/[id]/url
 *
 * Retorna o URL público obfuscado do attachment (Vercel Blob). Usado pelo
 * Newton pra responder "manda o RG do Yamamoto" — Newton manda esse URL pelo
 * WhatsApp e o user clica e baixa direto do CDN.
 *
 * Auth: Bearer (scope `documents:rw`) ou session. Cross-user guard via
 * deal.userId — bearer só vê attachments de deals próprios.
 *
 * Response: { url, filename, mime, dealId }
 *
 * Nota sobre signed URL: Vercel Blob URLs já contêm um random suffix que
 * funciona como token de longo prazo. Não há TTL — URL permanece válido até
 * o attachment ser deletado. Pra uso operacional (Newton entregando doc a
 * cliente que está conversando), permanente é OK. Se um dia precisar de TTL,
 * podemos rotear via proxy do /file endpoint que valida auth a cada request.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ident = await authOrBearer(req);
  if (!ident) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasScope(ident, "documents:rw")) {
    return NextResponse.json(
      { error: "Forbidden", reason: "missing scope documents:rw" },
      { status: 403 }
    );
  }

  const attachment = await prisma.dealAttachment.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      dealId: true,
      filename: true,
      mime: true,
      url: true,
      deal: { select: { userId: true } },
    },
  });

  if (!attachment) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Cross-user guard: bearer só acessa attachments de deals próprios.
  // Quando DELEGATION_ENABLED=true e Newton agindo como sales user, o
  // requireAuth/AuthContext já trocou `ident.userId` (mas aqui usamos authOrBearer
  // direto). Cross-user check abaixo usa ident.userId — quando delegação cai,
  // troca para usar AuthContext.userId.
  if (ident.via === "bearer" && attachment.deal.userId !== ident.userId) {
    return NextResponse.json(
      { error: "Forbidden", reason: "not the deal owner" },
      { status: 403 }
    );
  }

  return NextResponse.json({
    attachmentId: attachment.id,
    dealId: attachment.dealId,
    filename: attachment.filename,
    mime: attachment.mime,
    url: attachment.url,
  });
}
