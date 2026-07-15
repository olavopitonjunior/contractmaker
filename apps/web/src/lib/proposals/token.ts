import crypto from "node:crypto";

/**
 * Token do link público /p/[token].
 *
 * 256 bits de aleatoriedade — NÃO `cuid()`: cuid v1 tem ~40 bits imprevisíveis e
 * é monotônico no tempo (conhecendo um token, você conhece o prefixo dos
 * vizinhos). Este link entrega valor de imóvel, CPF e comissão a quem tiver a
 * URL, então precisa ser impossível de adivinhar/enumerar.
 */
export function generateProposalToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}
