import { prisma } from "@/lib/db/prisma";
import { getEffectiveUserId } from "@/lib/auth/impersonation";

/**
 * O usuário é owner ou admin DESTA org?
 *
 * Existe para ser um lugar só. A revisão da biblioteca precisa da mesma
 * resposta em três pontos — a rota que faz o levantamento, a página que a
 * chama, e os cabeçalhos que decidem se mostram o botão —, e três cópias do
 * mesmo `findFirst` é exatamente como um desses guardas diverge em silêncio:
 * o que some primeiro é o `getEffectiveUserId`, e aí a tela passa a responder
 * sobre o dono impersonador em vez do tenant que ele está vendo.
 *
 * `getEffectiveUserId` é a parte que não pode faltar: sob "testar como", quem
 * decide é o membro da org visitada, não a sessão de quem entrou.
 */
export async function isOrgOwnerAdmin(userId: string, orgId: string): Promise<boolean> {
  const effUserId = await getEffectiveUserId(userId);
  const membership = await prisma.orgMembership.findFirst({
    where: { userId: effUserId, orgId },
    select: { role: true },
  });
  return !!membership && ["owner", "admin"].includes(membership.role);
}
