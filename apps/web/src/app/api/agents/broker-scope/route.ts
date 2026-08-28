import { NextRequest, NextResponse } from "next/server";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { withApi } from "@/lib/api/with-api";
import { maxAgentRouteGate } from "@/lib/max/gate";
import { normalizeBrPhone } from "@/lib/validators/phone-br";
import { resolveBrokerByPhone } from "@/lib/max/broker-identity";

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
 * **Esta rota devolve IDENTIDADE E ESCOPO — ids, nunca conteúdo de negócio.**
 * Quem lê dados com projeção por sujeito é o `POST /api/agents/scope-query`
 * (PR 5, `docs/max.md` §12). São camadas diferentes e as duas continuam vivas:
 * o max-agent resolve a identidade aqui (`src/lib/identity.ts`, `src/lib/cm.ts`)
 * e lê negócio lá.
 *
 * **As três travas e o fail-closed saíram para `lib/max/broker-identity.ts`**,
 * para existir UMA implementação delas — duas portas para a mesma leitura
 * divergiriam em silêncio (`docs/max.md` §11.5). Esta rota ficou com o que é
 * dela: autenticação, entitlement e a tradução de `null` para 404.
 *
 * **404 é a resposta para tudo que não resolve** — telefone desconhecido, não
 * atribuído, inativo, de outro tenant ou duplicado na própria org. Distinguir os
 * casos confirmaria a existência de um cadastro para quem tem token de outra
 * org, que é exatamente o vazamento que o `by-phone` tinha.
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

    // Validação de ENTRADA fica aqui, e é 400 — separada do "não resolveu",
    // que é 404. Telefone impossível de normalizar não é um corretor ausente:
    // é um pedido malformado, e responder 404 a ele gastaria uma varredura e
    // ainda confundiria quem depura. Há teste travando este 400.
    const raw = req.nextUrl.searchParams.get("phone") ?? "";
    const e164 = normalizeBrPhone(raw);
    if (!e164) {
      return NextResponse.json(
        { error: "Bad Request", reason: "phone ausente ou não normalizável" },
        { status: 400 }
      );
    }

    const corretor = await resolveBrokerByPhone({ orgId, phone: e164 });
    if (!corretor) {
      return NextResponse.json(
        { error: "Not Found", reason: "corretor não atribuído a este tenant" },
        { status: 404 }
      );
    }

    return NextResponse.json(corretor);
  }
);
