import { z } from "zod";

export const INVITATION_ROLE_VALUES = [
  "admin",
  "finance",
  "sales",
  "gerente",
  "viewer",
  "member",
] as const;

/**
 * Body de POST /api/org/invitations.
 *
 * Mora fora da route handler porque route files do App Router não devem exportar
 * nada além dos handlers — e sem export não há como testar a validação.
 *
 * O `preprocess` do nome não é decoração: o diálogo de convite mantém o campo no
 * estado e manda `name: ""` quando o usuário não preenche. `.optional()` só aceita
 * `undefined`, então a string vazia caía no `.min(2)` e convidar informando apenas
 * o e-mail devolvia 400 — com o label da UI dizendo "Nome (opcional)".
 */
export const createInvitationSchema = z.object({
  email: z.string().email().max(200),
  name: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().min(2).max(120).optional()
  ),
  role: z.enum(INVITATION_ROLE_VALUES).optional().default("member"),
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

/** Mensagem de 400 que nomeia o campo reprovado (o "Dados inválidos" seco mandava
 *  o usuário procurar erro no e-mail quando o problema era outro campo). */
export function formatInvitationValidationError(error: z.ZodError): string {
  const detalhe = Object.entries(error.flatten().fieldErrors)
    .map(([campo, msgs]) => `${campo}: ${msgs?.[0] ?? "inválido"}`)
    .join("; ");
  return detalhe ? `Dados inválidos — ${detalhe}` : "Dados inválidos";
}
