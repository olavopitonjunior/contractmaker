import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  getEffectivePermissions,
  dealScopeWhere,
  proposalScopeWhere,
} from "@/lib/security/rbac/check";
import { resolveBrokerByPhone } from "@/lib/max/broker-identity";
import {
  projetarDeal,
  projetarProposta,
  type SubjectKind,
  type DealProjetado,
  type PropostaProjetada,
} from "@/lib/max/scope-projection";

/**
 * Execução dos verbos de leitura do `POST /api/agents/scope-query`.
 *
 * ── A regra que não pode ser afrouxada: escopo no `where`, nunca pós-fetch ──
 *
 * Filtrar depois de buscar significa que as linhas proibidas ESTIVERAM no
 * processo, e a partir daí qualquer log, exceção com contexto ou refactor
 * distraído as expõe. Aqui o banco nunca as devolve.
 *
 * ── ⚠️ `Deal` NÃO tem coluna `orgId` ────────────────────────────────────────
 *
 * A org de um negócio chega por `pipeline` (`Pipeline.orgId`), e é por isso que
 * todo `where` de deal aqui carrega `pipeline: { orgId }` À MÃO. Isso importa
 * mais do que parece por causa da assimetria abaixo, que é fácil de ler errado:
 *
 * - `dealScopeWhere(effective)` devolve `{}` para usuário irrestrito — é
 *   **fail-open por desenho** (preserva o status quo pré-RBAC) — e **não
 *   inclui a org**. Sozinho, ele não confina nada.
 * - `proposalScopeWhere(effective)` é o oposto: **fail-closed** (`null` quando
 *   falta permissão) e **já inclui `orgId`**, porque `Proposal` tem a coluna.
 *
 * Quem assume simetria entre os dois escreve um vazamento cross-tenant que
 * nenhum teste de RBAC pega, porque o RBAC está certo — o que falta é o tenant.
 *
 * ── O sujeito é reconferido no servidor ─────────────────────────────────────
 *
 * O Max não é acreditado a afirmar quem é a pessoa: ele manda `subject` E
 * `phone`, e aqui o vínculo é refeito. Um token de tenant comprometido que
 * mentisse o `subject` leria a carteira de outra pessoa da mesma org.
 */

export const VERBOS_DE_LEITURA = [
  "deal.list",
  "deal.detail",
  "deal.pending",
  "proposal.list",
  "proposal.detail",
] as const;

export type VerboDeLeitura = (typeof VERBOS_DE_LEITURA)[number];

/**
 * Status de `CertidaoJob` que ainda não desfecharam. É o que vira "pendência"
 * na conversa. `failed`/`skipped`/`replaced` NÃO entram: já desfecharam, e
 * listá-los faria o Max cobrar algo que ninguém precisa fazer.
 */
const STATUS_PENDENTE = ["pending", "fetching", "awaiting_portal"];

export type SujeitoResolvido =
  | { kind: "user"; userId: string; orgId: string }
  | { kind: "broker"; splitRecipientId: string; dealIds: string[] };

export type FalhaDeSujeito =
  | "subject_nao_confere"
  | "sujeito_nao_resolvido"
  | "sem_membership";

/**
 * Refaz o vínculo telefone→sujeito com as mesmas travas das rotas de identidade.
 *
 * Para `broker`, reusa `resolveBrokerByPhone` — que é a MESMA implementação que
 * o `/api/agents/broker-scope` usa. Isso não é só economia de código: traz de
 * graça a trava `maxEnabled` (a atribuição explícita da imobiliária), que a
 * especificação do `scope-query` não mencionava. Sem ela, um corretor não
 * atribuído ao tenant leria dados de negócio.
 */
export async function resolverSujeito(params: {
  orgId: string;
  phone: string;
  subject:
    | { kind: "user"; userId: string }
    | { kind: "broker"; splitRecipientId: string };
}): Promise<
  { ok: true; sujeito: SujeitoResolvido } | { ok: false; motivo: FalhaDeSujeito }
> {
  const { orgId, phone, subject } = params;

  if (subject.kind === "broker") {
    const corretor = await resolveBrokerByPhone({ orgId, phone });
    if (!corretor) return { ok: false, motivo: "sujeito_nao_resolvido" };
    // O telefone resolveu para UM corretor; se não é o que o Max afirmou, o
    // pedido é recusado em vez de servido para o corretor "certo". Servir o
    // outro esconderia a divergência e ainda entregaria dado a quem pediu.
    if (corretor.splitRecipientId !== subject.splitRecipientId) {
      return { ok: false, motivo: "subject_nao_confere" };
    }
    return {
      ok: true,
      sujeito: {
        kind: "broker",
        splitRecipientId: corretor.splitRecipientId,
        dealIds: corretor.dealIds,
      },
    };
  }

  // `User.phone` é @unique GLOBAL, então a linha pode ser de qualquer tenant —
  // o confinamento vem da membership NA ORG DE QUEM PERGUNTA, e não do telefone.
  const user = await prisma.user.findUnique({
    where: { phone },
    select: {
      id: true,
      deletedAt: true,
      orgMemberships: {
        where: { orgId },
        select: { orgId: true },
        take: 1,
      },
    },
  });

  if (!user || user.deletedAt || user.orgMemberships.length === 0) {
    return { ok: false, motivo: "sujeito_nao_resolvido" };
  }
  if (user.id !== subject.userId) {
    return { ok: false, motivo: "subject_nao_confere" };
  }

  return { ok: true, sujeito: { kind: "user", userId: user.id, orgId } };
}

/**
 * O `where` de deal para o sujeito — o ponto onde tenant e RBAC se somam.
 *
 * `null` significa "não há nada que este sujeito possa ver", e quem chama
 * devolve lista vazia. Não é erro: um gerente sem negócio atribuído é um caso
 * normal, e transformá-lo em 403 ensinaria o Max a dizer "não tenho acesso"
 * quando a resposta certa é "você não tem negócio aqui".
 */
export async function whereDeDeal(params: {
  orgId: string;
  sujeito: SujeitoResolvido;
}): Promise<Prisma.DealWhereInput | null> {
  const { orgId, sujeito } = params;

  if (sujeito.kind === "broker") {
    // Corretor comissionado não tem RBAC. O freio é a participação no negócio,
    // já resolvida por `resolveBrokerDeals`. Lista vazia de ids vira `null`:
    // `{ id: { in: [] } }` também devolveria nada, mas dizer isso explicitamente
    // evita que um refactor futuro leia o `in: []` como "sem filtro".
    if (sujeito.dealIds.length === 0) return null;
    return { pipeline: { orgId }, id: { in: sujeito.dealIds } };
  }

  const effective = await getEffectivePermissions(sujeito.userId, orgId);
  const escopo = dealScopeWhere(effective);
  if (escopo === null) return null;

  // `pipeline: { orgId }` NÃO é redundante com o `escopo`: `dealScopeWhere`
  // devolve `{}` para usuário irrestrito. Sem esta linha, um gerente com
  // `deal.view.all` leria os negócios de TODAS as orgs. Há teste com mutação
  // de controle travando exatamente isto.
  return { pipeline: { orgId }, ...escopo };
}

async function pendenciasPorDeal(
  dealIds: string[]
): Promise<Map<string, string[]>> {
  const mapa = new Map<string, string[]>();
  if (dealIds.length === 0) return mapa;

  const jobs = await prisma.certidaoJob.findMany({
    where: { dealId: { in: dealIds }, status: { in: STATUS_PENDENTE } },
    select: { dealId: true, label: true },
  });

  for (const j of jobs) {
    if (!j.dealId) continue;
    const atual = mapa.get(j.dealId) ?? [];
    // Distinto: o mesmo rótulo aparece uma vez por alvo diligenciado, e repetir
    // "certidão de ônus" cinco vezes na conversa não informa nada.
    if (!atual.includes(j.label)) atual.push(j.label);
    mapa.set(j.dealId, atual);
  }
  return mapa;
}

export interface ResultadoDeLeitura {
  items: (DealProjetado | PropostaProjetada)[];
  truncated?: boolean;
}

const LIMITE_PADRAO = 10;
const LIMITE_MAX = 50;

export async function executarVerbo(params: {
  verb: VerboDeLeitura;
  orgId: string;
  sujeito: SujeitoResolvido;
  args: { estado?: string; limite?: number; negocio_id?: string; proposta_id?: string };
}): Promise<ResultadoDeLeitura> {
  const { verb, orgId, sujeito, args } = params;
  const kind: SubjectKind = sujeito.kind;
  const limite = Math.min(Math.max(args.limite ?? LIMITE_PADRAO, 1), LIMITE_MAX);

  if (verb.startsWith("deal.")) {
    const base = await whereDeDeal({ orgId, sujeito });
    if (base === null) return { items: [] };

    const where: Prisma.DealWhereInput = { ...base };

    // **Só `deal.detail` EXIGE o id.** `deal.pending` responde "falta algo nos
    // meus negócios?" — a pergunta que o corretor faz SEM apontar um negócio, e
    // é a capability que `brokerDefault` concede por padrão (`docs/max.md`
    // §11.1). Agrupar os dois aqui fazia o caso de uso principal devolver vazio
    // em silêncio, que é falha fechada mas ainda assim errada.
    if (verb === "deal.detail" && !args.negocio_id) return { items: [] };

    if (args.negocio_id) {
      // O id pedido é INTERSECTADO com o escopo, nunca o substitui. Trocar um
      // pelo outro é o jeito clássico de transformar "detalhar" em IDOR — e
      // para o broker o escopo JÁ é `id: { in: [...] }`, então sobrescrever
      // abriria a carteira inteira da org para quem não tem RBAC atrás.
      where.id =
        typeof base.id === "object" && base.id !== null
          ? { ...(base.id as object), equals: args.negocio_id }
          : args.negocio_id;
    }

    // **A pendência entra no `where`, não num filtro pós-fetch.** Assim
    // `limite` e `truncated` contam NEGÓCIOS PENDENTES, que é o que quem
    // pergunta quer saber. Filtrando depois, um `limite: 10` varreria 10
    // negócios e devolveria só os que por acaso tivessem pendência entre eles —
    // e `truncated` falaria da varredura, não da resposta.
    if (verb === "deal.pending") {
      where.certidaoJobs = { some: { status: { in: STATUS_PENDENTE } } };
    }

    if (args.estado) where.stage = { name: args.estado };

    const deals = await prisma.deal.findMany({
      where,
      select: {
        id: true,
        title: true,
        clientName: true,
        value: true,
        updatedAt: true,
        stage: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: limite + 1,
    });

    const truncated = deals.length > limite;
    const janela = truncated ? deals.slice(0, limite) : deals;
    const pend = await pendenciasPorDeal(janela.map((d) => d.id));

    const items = janela.map((d) =>
      projetarDeal({ ...d, pendencias: pend.get(d.id) ?? [] }, kind)
    );

    return { items, truncated };
  }

  // Propostas. `proposalScopeWhere` já traz `orgId` e é fail-closed.
  if (sujeito.kind === "broker") {
    // Corretor comissionado não tem trilha de proposta: `Proposal` se liga a
    // `User` (criador/responsável), e não a `SplitRecipient`. Devolver vazio é
    // a resposta correta, não um erro.
    return { items: [] };
  }

  const effective = await getEffectivePermissions(sujeito.userId, orgId);
  const escopo = proposalScopeWhere(effective);
  if (escopo === null) return { items: [] };

  const where: Prisma.ProposalWhereInput = { ...escopo };
  if (verb === "proposal.detail") {
    if (!args.proposta_id) return { items: [] };
    // Atribuição direta, e NÃO a interseção cuidadosa do `deal.detail` — de
    // propósito, mas por um motivo frágil que vale escrever: `proposalScopeWhere`
    // devolve `{ orgId }` ou `{ orgId, OR: [...] }` e **nunca uma chave `id`**,
    // então aqui não há o que sobrescrever. Se um dia ele passar a restringir
    // por `id`, esta linha vira IDOR em silêncio e precisa virar interseção
    // como a do deal. Não é assimetria por descuido.
    where.id = args.proposta_id;
  }
  if (args.estado) where.status = args.estado;

  const propostas = await prisma.proposal.findMany({
    where,
    select: {
      id: true,
      code: true,
      title: true,
      status: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: limite + 1,
  });

  const truncated = propostas.length > limite;
  const janela = truncated ? propostas.slice(0, limite) : propostas;

  return { items: janela.map((p) => projetarProposta(p, kind)), truncated };
}
