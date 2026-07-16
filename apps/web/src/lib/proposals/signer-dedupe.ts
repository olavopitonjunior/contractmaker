import { onlyDigits } from "@/lib/validators/cpf";
import { toE164BR } from "./clicksign-readiness";

/**
 * Dedupe de signatários da proposta — a regra "só não pode ter duplicidade".
 *
 * Hoje, sem isto, o mesmo CPF duas vezes num envelope gera COBRANÇA DOBRADA e o
 * webhook marca um dos dois ao acaso. Estende o idioma que `mergeDefaultWitnesses`
 * já usa (Set de e-mails + CPFs), mas com escopo do envelope inteiro (proponente
 * × vendedores × cônjuges × testemunhas), não só testemunhas.
 */

export interface DedupableSigner {
  role: string;
  name: string;
  email?: string | null;
  cpf?: string | null;
  phone?: string | null;
  signingGroup: number;
}

/**
 * Chave canônica de identidade, em ordem de confiança:
 *   CPF (11 díg) → e-mail lowercase → nome normalizado + telefone E.164.
 *
 * Case-insensitive, sem acento, espaços colapsados. Determinística.
 */
export function computeDedupeKey(s: {
  name: string;
  email?: string | null;
  cpf?: string | null;
  phone?: string | null;
}): string {
  const cpf = onlyDigits(s.cpf ?? "");
  if (cpf.length === 11) return `cpf:${cpf}`;

  const email = (s.email ?? "").trim().toLowerCase();
  if (email.includes("@")) return `email:${email}`;

  const name = (s.name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const phone = toE164BR(s.phone) ?? "";
  return `name:${name}|${phone}`;
}

export class SignerCollisionError extends Error {
  constructor(
    public readonly key: string,
    public readonly names: [string, string]
  ) {
    super(
      `Signatário duplicado entre grupos de assinatura diferentes: "${names[0]}" e "${names[1]}"`
    );
    this.name = "SignerCollisionError";
  }
}

export interface DedupeResult {
  signers: DedupableSigner[];
  /** Papéis fundidos por signatário (a mesma pessoa em 2 papéis). */
  merged: Array<{ key: string; roles: string[] }>;
}

/**
 * Deduplica a lista.
 *
 * - Colisão DENTRO do mesmo grupo de assinatura → MERGE: a ClickSign aceita N
 *   requirements `action:"agree"` com `role` diferente pro mesmo signer (o dono
 *   que também é procurador do outro). Um signer, N papéis, um custo.
 * - Colisão ENTRE grupos diferentes (mesmo CPF como proponente E vendedor) →
 *   erro duro: seria a pessoa assinando duas vezes em ordens diferentes, o que
 *   é dado errado (ou fraude). Nunca deixar passar.
 */
export function dedupeSigners(input: DedupableSigner[]): DedupeResult {
  const byKey = new Map<
    string,
    { signer: DedupableSigner; roles: string[]; group: number }
  >();

  for (const s of input) {
    const key = computeDedupeKey(s);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { signer: { ...s }, roles: [s.role], group: s.signingGroup });
      continue;
    }
    if (existing.group !== s.signingGroup) {
      throw new SignerCollisionError(key, [existing.signer.name, s.name]);
    }
    // Mesmo grupo → funde papéis. Preserva o primeiro conjunto de contatos.
    if (!existing.roles.includes(s.role)) existing.roles.push(s.role);
    existing.signer.email = existing.signer.email ?? s.email;
    existing.signer.cpf = existing.signer.cpf ?? s.cpf;
    existing.signer.phone = existing.signer.phone ?? s.phone;
  }

  const merged: DedupeResult["merged"] = [];
  for (const [key, v] of byKey) {
    if (v.roles.length > 1) merged.push({ key, roles: v.roles });
  }
  return {
    signers: Array.from(byKey.values()).map((v) => v.signer),
    merged,
  };
}
