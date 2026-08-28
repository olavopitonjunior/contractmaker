import { prisma } from "@/lib/db/prisma";
import { normalizeBrPhone } from "@/lib/validators/phone-br";
import { resolveBrokerDeals } from "@/lib/notifications/deal-brokers";

/**
 * Resolução de identidade do corretor comissionado a partir do telefone.
 *
 * Isto nasceu DENTRO de `app/api/agents/broker-scope/route.ts` e saiu para cá
 * quando o `scope-query` (PR 5) passou a precisar da mesma resposta. O motivo de
 * extrair em vez de reimplementar é o modo de falha que `docs/max.md` §11.5
 * descreve: duas portas para a mesma leitura divergem **em silêncio** — sem log,
 * sem erro e sem teste vermelho — e quem descobre é o corretor que passou a ver
 * o que não devia.
 *
 * As três travas moram aqui, e cada uma responde a uma pergunta diferente:
 *
 * 1. **A org vem do chamador**, nunca do telefone. Quem chama já fixou o tenant
 *    pelo dono do token (`requireApiAuth` pina `subdomainHint: null` no caminho
 *    de máquina); este módulo só recebe o `orgId` pronto e nunca o descobre.
 * 2. **`maxEnabled` é a atribuição explícita da imobiliária.**
 *    `SplitRecipient.phone` não tem unique nenhum — ao contrário de `User.phone`,
 *    que é `@unique` global —, então o MESMO corretor existe como commissioner
 *    em N orgs. O telefone diz que ele é corretor; só o dono do tenant diz que
 *    ele é corretor DA CASA. Default `false`: um corretor de imobiliária
 *    parceira, que legitimamente recebe aviso de um negócio compartilhado, não
 *    conversa com este agente.
 * 3. **`resolveBrokerDeals` corta por participação** no negócio. Ser membro do
 *    tenant não é ser parte do negócio.
 *
 * **`null` é a resposta para tudo que não resolve** — telefone desconhecido, não
 * atribuído, inativo, de outro tenant, ou duplicado dentro da mesma org.
 * Quem chama traduz para 404 sem distinguir os casos: separá-los confirmaria a
 * existência de um cadastro para quem tem token de outra org.
 *
 * O caso do **duplicado na mesma org** merece nota, porque a saída fácil é
 * errada: sem unique, duas linhas podem ter o mesmo número, e não há como saber
 * qual delas mandou a mensagem. Devolver a união dos dois escopos daria a um
 * corretor os negócios do outro. Fail-closed — quem opera resolve o cadastro.
 */
export interface BrokerIdentity {
  splitRecipientId: string;
  label: string;
  dealIds: string[];
  /** "não olhei além daqui", NÃO "não participa de mais nenhum". */
  scanned: number;
  truncated: boolean;
}

export async function resolveBrokerByPhone(params: {
  orgId: string;
  phone: string;
}): Promise<BrokerIdentity | null> {
  const { orgId } = params;

  const e164 = normalizeBrPhone(params.phone);
  if (!e164) return null;

  // O filtro fino é em JS porque `SplitRecipient.phone` guarda formato LIVRE
  // ("(11) 99906-3228") — não dá para casar E.164 em SQL. O `where` abaixo
  // reduz ao roster atribuído e ativo da org, que é dezenas de linhas, e é o
  // conjunto que o índice parcial da migration serve.
  const candidatos = await prisma.splitRecipient.findMany({
    where: { orgId, kind: "commissioner", maxEnabled: true, active: true },
    select: { id: true, label: true, phone: true },
  });

  const casaram = candidatos.filter(
    (c) => c.phone && normalizeBrPhone(c.phone) === e164
  );

  // Zero e mais-de-um caem no mesmo `null`, por motivos diferentes: um não
  // existe, o outro é ambíguo e escolher seria arbitrar o escopo de negócio
  // de alguém.
  if (casaram.length !== 1) return null;

  const corretor = casaram[0];
  const { dealIds, scanned, truncated } = await resolveBrokerDeals({
    orgId,
    splitRecipientId: corretor.id,
  });

  return {
    splitRecipientId: corretor.id,
    label: corretor.label,
    dealIds,
    scanned,
    truncated,
  };
}
