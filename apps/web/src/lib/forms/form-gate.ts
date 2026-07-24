import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { isFormFinished } from "@/lib/forms/form-status";

/**
 * Gate de acesso ao formulário público DEPOIS que ele foi enviado.
 *
 * Problema que isso fecha: o link `/f/[token]` (e o subtoken `/f/p/[...]`) é
 * entregue ao cliente e vale pra sempre. Enquanto o form está aberto isso é o
 * ponto — o cliente precisa preencher sem login. Mas depois de enviado o
 * `dataJson` vira um dossiê de PII (CPF, RG, nome da mãe, PIX/dados bancários
 * de todas as partes) que continuava legível por qualquer um que tivesse (ou
 * achasse) o link. O `lockedAt` NÃO resolvia isso: ele só barra escrita, e a
 * leitura seguia aberta.
 *
 * Regra: form fechado → só membro da org dona do form.
 *
 * ## Por que `completedAt` e não `status === "completo"`
 *
 * O schema define `completedAt` como setado quando o status vai pra "completo"
 * OU "vinculado" (SalesForm, schema.prisma). Todo deal criado por
 * upload/import/proposta nasce `vinculado` e NUNCA transiciona pra "completo" —
 * gatear pela string deixaria 100% desses forms públicos pra sempre. O campo de
 * data é o discriminador canônico de "esse form fechou" e não quebra quando
 * aparecer um terceiro status. (`send-summary` já usava o par completo/vinculado;
 * aqui unificamos no campo que os dois setam.)
 *
 * ## Escopo honesto
 *
 * Isto barra DESCOBERTA nova. Não revoga o que já vazou: os anexos moram em
 * URLs públicas e permanentes do Vercel Blob, e `attachments/[id]/file`
 * redireciona pra elas. Quem já abriu o form uma vez segue com as URLs diretas.
 * Revogação real exige blob privado + URL assinada — item à parte.
 */

/** O mínimo que o gate precisa saber sobre o form. */
export interface FormGateSubject {
  orgId: string;
  completedAt: Date | null;
  /** "rascunho" | "completo" | "vinculado" — ver `isFormClosed`. */
  status?: string | null;
  /**
   * Reaberto pela imobiliária (`POST .../lock { reopen: true }`) → volta a ser
   * público até o próximo finalize. Fica separado de `completedAt` porque este
   * é marco de SLA e não pode ser zerado só pra destravar o link.
   */
  reopenedAt?: Date | null;
}

/**
 * Fechado = o form terminou e ainda não foi reaberto.
 *
 * "Terminou" tem DOIS caminhos, e é preciso cobrir os dois:
 *
 *  - `completedAt` — o cliente finalizou pelo link (`PATCH` com
 *    `status: "completo"`). É o único lugar do código que grava esse campo.
 *  - `status === "vinculado"` — o form nasceu preso a um contrato criado por
 *    outra via (import de CCV, cadastro rápido com upload, proposta). Esses
 *    NUNCA passam pelo finalize, então **nunca ganham `completedAt`** — o
 *    comentário do schema sugere o contrário, mas nenhum caminho o seta
 *    (`import-contract`, `contract-import.ts`, `pipeline/deals`,
 *    `locacao/deals` criam com status e sem data). E o dataJson deles é
 *    justamente o que o Gemini extraiu do CCV: PII completa de todas as
 *    partes. Gatear só por `completedAt` deixaria 100% deles abertos pra
 *    sempre — o oposto do objetivo.
 */
export function isFormClosed(form: FormGateSubject): boolean {
  return isFormFinished(form) && !form.reopenedAt;
}

/**
 * O visitante atual é membro desta org?
 *
 * Checa a MEMBERSHIP contra a org do form, e não `getUserOrg()` — um usuário
 * pode ser membro de várias orgs, e `getUserOrg` resolve só uma (a primeira ou
 * a do subdomínio). "Tem sessão" sozinho seria IDOR cross-org: qualquer usuário
 * logado de qualquer tenant leria o form de outro só por ter o link.
 */
export async function viewerIsOrgMember(orgId: string): Promise<boolean> {
  const session = await auth().catch(() => null);
  const userId = session?.user?.id;
  if (!userId) return false;

  const membership = await prisma.orgMembership
    .findFirst({
      where: { userId, orgId },
      select: { id: true },
    })
    .catch(() => null);

  return Boolean(membership);
}

/**
 * Form aberto → true pra qualquer um (é o fluxo público normal).
 * Form fechado → só membro da org.
 */
export async function canAccessForm(form: FormGateSubject): Promise<boolean> {
  if (!isFormClosed(form)) return true;
  return viewerIsOrgMember(form.orgId);
}

/**
 * Guard pras rotas públicas. Retorna a resposta 403 quando o form está fechado
 * e o visitante não é da org; `null` quando pode seguir.
 *
 * `reason: "form_closed"` deixa o client distinguir de `form_locked` (travado,
 * mas legível) — sem isso a UI mostra a mensagem errada e o auto-save fica
 * retentando (ver `useAutoSave`).
 */
export async function formClosedResponse(
  form: FormGateSubject
): Promise<NextResponse | null> {
  if (await canAccessForm(form)) return null;
  return NextResponse.json(
    {
      error: "Formulário já enviado — o link não está mais disponível",
      reason: "form_closed",
    },
    { status: 403 }
  );
}
