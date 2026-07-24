import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/prisma";

/**
 * Token público do link de pesquisa (/s/[token]). Mesmo padrão do
 * participant-token: 16 bytes aleatórios em base64url (22 chars, 128 bits,
 * URL-safe) — curto o bastante pra WhatsApp, e a autenticação é a própria
 * busca por `token` (@unique) + checagem de `tokenExp`.
 */

const TTL_SECONDS = 30 * 24 * 60 * 60; // 30d — pesquisa tolera mais espera que form

export function newSurveyToken(): { token: string; exp: Date } {
  return {
    token: randomBytes(16).toString("base64url"),
    exp: new Date(Date.now() + TTL_SECONDS * 1000),
  };
}

export type ResolveSurveyTokenResult =
  | {
      ok: true;
      invite: {
        id: string;
        orgId: string;
        templateId: string;
        dealId: string | null;
        recipientRole: string;
        recipientName: string | null;
        status: string;
        tokenExp: Date;
      };
    }
  | { ok: false; error: string };

/**
 * Resolve um token de pesquisa. Não distingue "nunca existiu" de "revogado"
 * de propósito. Status responded/optout NÃO é erro aqui — a página decide o
 * que mostrar (gate de agradecimento vs formulário).
 */
export async function resolveSurveyToken(
  token: string
): Promise<ResolveSurveyTokenResult> {
  if (!token || token.length > 300) {
    return { ok: false, error: "Link inválido ou expirado" };
  }

  const invite = await prisma.surveyInvite
    .findUnique({
      where: { token },
      select: {
        id: true,
        orgId: true,
        templateId: true,
        dealId: true,
        recipientRole: true,
        recipientName: true,
        status: true,
        tokenExp: true,
      },
    })
    .catch(() => null);

  if (!invite) return { ok: false, error: "Link inválido ou expirado" };
  if (invite.status !== "responded" && invite.tokenExp.getTime() < Date.now()) {
    return { ok: false, error: "Link expirado — peça um novo à imobiliária" };
  }

  return { ok: true, invite };
}
