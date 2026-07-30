import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import {
  TERCEIRO_ROLE_PREFIX,
  parseTerceiroRole,
} from "./participant-category";

/**
 * Subtoken por parte (vendedor/comprador; locador/locatário/fiador) pro form
 * público. Server filtra `dataJson` por `ROLE_PATHS[role]` na leitura e enforça
 * a allowlist via `deepMergeAtPaths` no PATCH.
 *
 * ## Por que é um token opaco, e não um JWT
 *
 * Era um JWT-HMAC de ~257 chars, o que fazia a URL do link — mandada pro
 * cliente por WhatsApp — passar de 280 caracteres. O comentário antigo
 * justificava o formato dizendo que o token era "stateless (assinatura
 * suficiente pra autenticar)", mas o código nunca foi stateless: toda rota
 * verificava a assinatura e **em seguida ia ao banco assim mesmo**, porque
 * `SalesFormParticipant.token` precisa bater com o valor persistido (é o que
 * faz "regenerar link" invalidar o antigo).
 *
 * Ou seja: a ida ao banco já autenticava sozinha, e `tokenExp` já era coluna.
 * A assinatura não comprava nada — só 235 chars de URL. Agora o token é 16
 * bytes aleatórios em base64url (22 chars, 128 bits, URL-safe) e a
 * autenticação é a própria busca por `token` (`@unique`) + checagem de
 * `tokenExp`.
 *
 * ## Links antigos continuam valendo
 *
 * Os JWTs já emitidos estão gravados na coluna `token`. Como a autenticação
 * virou `findUnique({ token })`, um link legado resolve normalmente — pro banco
 * é só uma string opaca comprida. Eles somem sozinhos no `tokenExp` (7d). Sem
 * migração, sem link quebrado.
 */

// Venda: vendedor/comprador. Locação: locador/locatario/fiador (validados
// contra o schemaType do form na criação — POST /participants).
export type ParticipantRole =
  | "vendedor"
  | "comprador"
  | "locador"
  | "locatario"
  | "fiador";

export const PARTICIPANT_ROLES: ReadonlySet<ParticipantRole> = new Set([
  "vendedor",
  "comprador",
  "locador",
  "locatario",
  "fiador",
]);

/**
 * Role de categoria customizável da org (`terceiro:<slug>`) — ver
 * `lib/forms/participant-category.ts`. Não é enum no banco: `role` sempre foi
 * String, então a categoria nova não precisa de migration de dados.
 */
export type TerceiroRole = `${typeof TERCEIRO_ROLE_PREFIX}${string}`;

/** Papel nativo OU categoria de terceiro. */
export type AnyParticipantRole = ParticipantRole | TerceiroRole;

export function isBuiltInParticipantRole(
  role: string,
): role is ParticipantRole {
  return PARTICIPANT_ROLES.has(role as ParticipantRole);
}

const TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Token novo + sua expiração. 16 bytes = 128 bits de entropia: inadivinhável,
 * e curto o bastante pra caber numa mensagem sem virar parágrafo.
 */
export function newParticipantToken(): { token: string; exp: Date } {
  return {
    token: randomBytes(16).toString("base64url"),
    exp: new Date(Date.now() + TTL_SECONDS * 1000),
  };
}

export type ResolveParticipantResult =
  | {
      ok: true;
      participant: {
        id: string;
        role: AnyParticipantRole;
        partyIndex: number;
        formId: string;
        tokenExp: Date;
        completedAt: Date | null;
      };
    }
  | { ok: false; error: string };

/**
 * Resolve um subtoken. É a autenticação inteira: token desconhecido não existe
 * no banco, e token vencido é barrado por `tokenExp`.
 *
 * Não distingue "nunca existiu" de "revogado" de propósito — quem tem o link
 * não precisa saber qual dos dois.
 */
export async function resolveParticipantToken(
  token: string
): Promise<ResolveParticipantResult> {
  if (!token) return { ok: false, error: "Token inválido ou revogado" };

  const participant = await prisma.salesFormParticipant
    .findUnique({
      where: { token },
      select: {
        id: true,
        role: true,
        partyIndex: true,
        formId: true,
        tokenExp: true,
        completedAt: true,
      },
    })
    .catch(() => null);

  if (!participant) return { ok: false, error: "Token inválido ou revogado" };
  if (participant.tokenExp.getTime() < Date.now()) {
    return { ok: false, error: "Link expirado — peça um novo à imobiliária" };
  }
  // Nativo (allowlist fechada) OU `terceiro:<slug>` bem-formado. A EXISTÊNCIA
  // da categoria não é checada aqui: quem resolve o token ainda não sabe a org,
  // e a validação real (categoria ativa, módulo compatível) mora na página e no
  // PATCH, que já carregam o form. Slug malformado morre aqui.
  const isKnownRole =
    isBuiltInParticipantRole(participant.role) ||
    parseTerceiroRole(participant.role) !== null;
  if (!isKnownRole) {
    return { ok: false, error: "Papel de participante desconhecido" };
  }

  return {
    ok: true,
    participant: {
      ...participant,
      role: participant.role as AnyParticipantRole,
    },
  };
}
