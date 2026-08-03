import { NextRequest, NextResponse } from "next/server";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { withApi } from "@/lib/api/with-api";
import { prisma } from "@/lib/db/prisma";
import { maxAgentRouteGate } from "@/lib/max/gate";
import { normalizeBrPhone } from "@/lib/validators/phone-br";
import { resolveBrokerDeals } from "@/lib/notifications/deal-brokers";

export const dynamic = "force-dynamic";

/**
 * GET /api/agents/broker-scope?phone=+5511999999999
 *
 * Responde "de que negócios este corretor participa" para o agente de WhatsApp,
 * que recebe uma mensagem e só tem o telefone.
 *
 * Sem esta rota o agente teria duas saídas ruins: não falar de negócio nenhum
 * (inútil) ou falar de todos da org (vazamento). A segunda é fácil de escrever
 * por engano, porque o corretor É membro legítimo daquele tenant — o que ele
 * não é, necessariamente, é parte daquele negócio.
 *
 * **Três travas, e cada uma responde a uma pergunta diferente:**
 *
 * 1. `requireApiAuth` fixa a org no dono do token (`subdomainHint: null` no
 *    caminho de máquina). A varredura é sempre dentro de UM tenant.
 * 2. `maxEnabled` é a atribuição explícita da imobiliária. `SplitRecipient.phone`
 *    não tem unique nenhum — ao contrário de `User.phone`, que é @unique global
 *    —, então o MESMO corretor existe como commissioner em N orgs. O telefone
 *    diz que ele é corretor; só o dono do tenant diz que ele é corretor DA CASA.
 *    Default false: um corretor de imobiliária parceira, que legitimamente
 *    recebe aviso de um negócio compartilhado, não fala com este agente.
 * 3. `resolveBrokerDeals` corta por participação no negócio.
 *
 * **404 é a resposta para tudo que não resolve** — telefone desconhecido, não
 * atribuído, inativo, ou de outro tenant. Distinguir os casos confirmaria a
 * existência de um cadastro para quem tem token de outra org, que é exatamente
 * o vazamento que o `by-phone` tinha.
 *
 * **Telefone duplicado DENTRO da mesma org também é 404.** Sem unique, duas
 * linhas podem ter o mesmo número, e não há como saber qual delas mandou a
 * mensagem — devolver a união dos dois escopos daria a um corretor os negócios
 * do outro. Fail-closed: quem opera resolve o cadastro duplicado.
 */
export const GET = withApi(
  "GET /api/agents/broker-scope",
  async (req: NextRequest) => {
    const authed = await requireApiAuth(req, { scope: "agents:r" });
    if (isAuthFailure(authed)) return authFailureResponse(authed);
    const orgId = authed.org.id;

    const denied = await maxAgentRouteGate({
      orgId,
      via: authed.ident.via,
      agentKey: "max",
    });
    if (denied) return denied;

    const raw = req.nextUrl.searchParams.get("phone") ?? "";
    const e164 = normalizeBrPhone(raw);
    if (!e164) {
      return NextResponse.json(
        { error: "Bad Request", reason: "phone ausente ou não normalizável" },
        { status: 400 }
      );
    }

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

    // Zero e mais-de-um caem no mesmo 404, por motivos diferentes: um não
    // existe, o outro é ambíguo e escolher seria arbitrar o escopo de negócio
    // de alguém.
    if (casaram.length !== 1) {
      return NextResponse.json(
        { error: "Not Found", reason: "corretor não atribuído a este tenant" },
        { status: 404 }
      );
    }

    const corretor = casaram[0];
    const { dealIds, scanned, truncated } = await resolveBrokerDeals({
      orgId,
      splitRecipientId: corretor.id,
    });

    return NextResponse.json({
      splitRecipientId: corretor.id,
      label: corretor.label,
      dealIds,
      // Explícito porque a diferença importa para quem consome: `truncated`
      // significa "não olhei além daqui", não "não participa de mais nenhum".
      scanned,
      truncated,
    });
  }
);
