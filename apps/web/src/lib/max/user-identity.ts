import { prisma } from "@/lib/db/prisma";

/**
 * Resolução de usuário da plataforma por telefone, confinada à org de quem
 * pergunta.
 *
 * Isto nasceu dentro de `app/api/users/by-phone/route.ts` e saiu para cá quando
 * o `user-scope` (dívidas do PR 6) passou a precisar da mesma resposta com um
 * campo a mais. O motivo de extrair em vez de reimplementar é o mesmo do
 * `broker-identity.ts`: duas portas para a mesma leitura divergem **em
 * silêncio**, e aqui o que divergiria é a política de 404 — que é decisão de
 * segurança, não detalhe.
 *
 * **As duas travas:**
 *
 * 1. **A org vem do chamador, nunca do telefone.** `User.phone` é `@unique`
 *    GLOBAL, então a linha pode ser de qualquer tenant; o confinamento vem da
 *    membership NA ORG DE QUEM PERGUNTA. Sem isso, qualquer token com o escopo
 *    certo resolvia qualquer telefone da plataforma — foi um vazamento real,
 *    corrigido quando esta lógica ainda morava na rota.
 * 2. **Um 404 só para os três casos** (não existe / apagado / é de outro
 *    tenant). Separá-los revelaria que o número pertence a alguém na
 *    plataforma. Aqui isso é `null`; quem chama traduz.
 *
 * A membership é buscada com `take: 1` filtrando pela org do caller — não é
 * "a primeira org do usuário". Um usuário multi-org (o corretor que atende duas
 * casas) tem uma membership por casa, e devolver a errada trocaria a persona e
 * a base de conhecimento da imobiliária.
 */
export interface UsuarioPorTelefone {
  userId: string;
  name: string | null;
  orgId: string;
  /** O literal cru de `OrgMembership.role`. */
  role: string;
  /** `CustomRole.id` quando `role === "custom"`. */
  customRoleId: string | null;
}

export async function resolveUserByPhone(params: {
  orgId: string;
  phoneE164: string;
}): Promise<UsuarioPorTelefone | null> {
  const user = await prisma.user.findUnique({
    where: { phone: params.phoneE164 },
    select: {
      id: true,
      name: true,
      deletedAt: true,
      orgMemberships: {
        where: { orgId: params.orgId },
        select: { orgId: true, role: true, customRoleId: true },
        take: 1,
      },
    },
  });

  if (!user || user.deletedAt || user.orgMemberships.length === 0) return null;

  const m = user.orgMemberships[0];
  return {
    userId: user.id,
    name: user.name,
    orgId: m.orgId,
    role: m.role,
    customRoleId: m.customRoleId ?? null,
  };
}

/**
 * A chave com que `MaxCapabilityPolicy.byRole` indexa esta pessoa.
 *
 * ── O problema que isto resolve ────────────────────────────────────────────
 *
 * `OrgMembership.role` grava o literal `"custom"` para TODO papel customizado
 * de tenant, com o papel real em `customRoleId`. Como a política é indexada por
 * `role`, um "Estagiário" e um "Diretor" da mesma imobiliária caíam os dois em
 * `byRole.custom` — impossível dar tetos diferentes. Pior: o usuário de serviço
 * do próprio Max tem `role = "custom"` (o `upsertMaxRole` cria um `CustomRole`
 * chamado "Max (agente)" por org), então aquela chave já estava ocupada antes
 * de existir papel customizado humano.
 *
 * **A chave é o ID, não o nome.** `CustomRole` tem `@@unique([orgId, name])`, e
 * o nome seria mais legível — mas renomear o papel apagaria a configuração em
 * silêncio. Chave por id sobrevive à renomeação; a tela resolve o id para o
 * nome na hora de exibir, que é onde a legibilidade importa.
 *
 * **`null` é fail-closed, e é o caso degenerado de propósito.** `role` é
 * `String` livre no banco (default `"member"`), então existe linha com
 * `role: "custom"` e `customRoleId` nulo — membership quebrada. Devolver
 * `"custom"` ali faria essa pessoa herdar o que quer que `byRole.custom`
 * conceda. `null` resolve para NENHUMA capability, que é a postura da regra 3.
 */
export function chaveDePolitica(u: {
  role: string;
  customRoleId: string | null;
}): string | null {
  if (u.role !== "custom") return u.role;
  return u.customRoleId ? `custom:${u.customRoleId}` : null;
}
