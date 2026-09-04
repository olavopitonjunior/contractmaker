import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Evidência de consentimento LGPD (art. 7º) do formulário público.
 *
 * Vivia dentro de `api/forms/[token]/route.ts`, privado à esteira de VENDA — e
 * por isso a locação nunca o teve: o wizard de lá coletava o aceite, usava-o
 * para habilitar o botão "Finalizar" e nunca o enviava, então
 * `SalesForm.privacyAcceptedAt` ficava nulo mesmo com o titular tendo marcado a
 * caixa. Consentimento sem evidência registrada.
 *
 * Compartilhar não é só evitar duplicação: a VERSÃO DA POLÍTICA é a prova de
 * QUAL texto a pessoa aceitou. Duas cópias divergiriam no primeiro bump, e o
 * acervo passaria a conter duas afirmações contraditórias sobre o mesmo fato.
 */

/**
 * Versão da política de privacidade vigente — bump ao alterar /privacy.
 *
 * O bump é BILATERAL desde que esta constante saiu de dentro da rota de venda:
 * ele passa a valer para venda e locação no mesmo instante. É o comportamento
 * desejado (as duas servem a mesma política), mas quem alterar `/privacy`
 * precisa saber que não existe mais como versionar uma esteira sem a outra.
 */
export const PRIVACY_POLICY_VERSION = "2026-07-16";

/** Hash do IP (nunca o IP cru) pra evidência de consentimento LGPD. */
export function hashIp(req: NextRequest): string | null {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;
  if (!ip) return null;
  const secret = process.env.AUTH_SECRET ?? "";
  return createHash("sha256").update(`${ip}:${secret}`).digest("hex");
}

/**
 * Deve gravar a evidência agora?
 *
 * Exige aceite **EXPLÍCITO** (`=== true`). Um `!== false` fabricaria prova de
 * consentimento que o titular nunca deu — que é pior do que não ter prova
 * nenhuma, porque parece prova.
 *
 * Só na PRIMEIRA finalização: reabrir e re-enviar não reescreve a data em que o
 * titular de fato consentiu.
 */
export function shouldRecordConsent(args: {
  isFinalizing: boolean;
  alreadyAcceptedAt: Date | null;
  bodyPrivacyAccepted: unknown;
}): boolean {
  return (
    args.isFinalizing &&
    !args.alreadyAcceptedAt &&
    args.bodyPrivacyAccepted === true
  );
}

/** Os três campos de evidência, prontos para o `update`. */
export function consentFields(req: NextRequest): {
  privacyAcceptedAt: Date;
  privacyIpHash: string | null;
  privacyPolicyVersion: string;
} {
  return {
    privacyAcceptedAt: new Date(),
    privacyIpHash: hashIp(req),
    privacyPolicyVersion: PRIVACY_POLICY_VERSION,
  };
}
