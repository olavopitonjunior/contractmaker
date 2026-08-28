import { NextRequest, NextResponse } from "next/server";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { withApi } from "@/lib/api/with-api";
import { maxAgentRouteGate } from "@/lib/max/gate";
import { normalizeBrPhone } from "@/lib/validators/phone-br";
import {
  resolveUserByPhone,
  chaveDePolitica,
} from "@/lib/max/user-identity";

export const dynamic = "force-dynamic";

/**
 * GET /api/agents/user-scope?phone=+5511999999999
 *
 * Responde "qual a CHAVE DE POLÍTICA desta pessoa, agora" para o agente de
 * WhatsApp. Par simétrico do `broker-scope`: aquele resolve o corretor
 * comissionado, este resolve o usuário da plataforma.
 *
 * ── Por que a chave vem do servidor, e não do Max ──────────────────────────
 *
 * O Max carregava `role` no candidato de identidade, e isso tinha dois
 * defeitos que são o mesmo defeito — um atributo de autorização derivado,
 * transportado e guardado por quem não pode mantê-lo correto:
 *
 * 1. **Congelava.** Quem já desambiguou de qual imobiliária fala é resolvido
 *    pela `phone_org_choice`, que devolve o candidato gravado na hora da
 *    PERGUNTA e nunca revarre — e aquela tabela não tem TTL, por decisão (é
 *    escolha da pessoa, não cache). Rebaixar alguém na plataforma não revogava
 *    o que o Max oferecia.
 * 2. **Não distinguia papel customizado.** Ver `chaveDePolitica`.
 *
 * Buscando aqui, por turn, a chave nunca envelhece e é calculada por quem
 * enxerga `customRoleId`.
 *
 * ── O que esta rota NÃO faz, de propósito ──────────────────────────────────
 *
 * **Não resolve capabilities.** O catálogo é canônico no
 * `max-agent/src/graph/policy.ts`, e uma segunda lista aqui existiria para
 * divergir (`docs/max.md` §11.2) — obrigaria deploy coordenado a cada
 * capability nova. O servidor emite a CHAVE; a álgebra da política (deny vence
 * allow, capability desconhecida ignorada) continua com uma implementação só,
 * do outro lado.
 *
 * **Não substitui o `/api/users/by-phone`.** Aquela rota tem outros
 * consumidores — duas MCP tools, contrato no `openapi.json` — e seu shape não
 * muda. As duas compartilham a MESMA resolução
 * (`lib/max/user-identity.ts`), extraída para não divergirem em silêncio.
 *
 * **404 é a resposta para tudo que não resolve** — telefone desconhecido,
 * usuário apagado, ou de outro tenant. Distinguir os casos confirmaria a
 * existência de um cadastro para quem tem token de outra org.
 */
export const GET = withApi(
  "GET /api/agents/user-scope",
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

    // Validação de ENTRADA é 400, separada do "não resolveu", que é 404 —
    // mesma separação do `broker-scope`, e pelo mesmo motivo: telefone
    // impossível de normalizar é pedido malformado, não pessoa ausente.
    const raw = req.nextUrl.searchParams.get("phone") ?? "";
    const e164 = normalizeBrPhone(raw);
    if (!e164) {
      return NextResponse.json(
        { error: "Bad Request", reason: "phone ausente ou não normalizável" },
        { status: 400 }
      );
    }

    const usuario = await resolveUserByPhone({ orgId, phoneE164: e164 });
    if (!usuario) {
      return NextResponse.json(
        { error: "Not Found", reason: "usuário não encontrado neste tenant" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      userId: usuario.userId,
      // `null` quando a membership é degenerada (`custom` sem `customRoleId`).
      // Resolve para NENHUMA capability do outro lado — fail-closed.
      roleKey: chaveDePolitica(usuario),
    });
  }
);
