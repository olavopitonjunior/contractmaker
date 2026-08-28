import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { withApi } from "@/lib/api/with-api";
import { maxAgentRouteGate } from "@/lib/max/gate";
import { normalizeBrPhone } from "@/lib/validators/phone-br";
import {
  VERBOS_DE_LEITURA,
  resolverSujeito,
  executarVerbo,
} from "@/lib/max/scope-query";

export const dynamic = "force-dynamic";

/**
 * POST /api/agents/scope-query
 *
 * A porta de LEITURA de negócio do Max, com escopo aplicado no `where` e
 * projeção por tipo de sujeito. Contrato normativo em `docs/max.md` §12.
 *
 * **Nasce sem consumidor, e isso é o desenho** (regra 2 da governança: receptor
 * primeiro, inerte). O nó `tools` que a chama é o PR 6. Entregar a rota antes
 * do emissor é o que permite ligar o outro lado sem uma janela em que ele
 * chama algo que ainda não existe.
 *
 * **Não substitui o `GET /api/agents/broker-scope`** — são camadas diferentes.
 * Aquela resolve IDENTIDADE e escopo (telefone → corretor + ids de negócio, sem
 * conteúdo) e já é consumida em produção pelo max-agent. Esta lê DADOS. As duas
 * compartilham a mesma resolução (`lib/max/broker-identity.ts`) justamente para
 * não divergirem em silêncio.
 *
 * ── Auth: `agents:rw` e só Bearer ──────────────────────────────────────────
 *
 * Exigir escopo de ESCRITA para uma leitura é deliberado, e não um descuido: é
 * o que mantém a rota fora do alcance de um token `agents:r` e de sessão de
 * navegador. Espelha o `POST /api/agents/usage`. O token do Max já carrega
 * `agents:rw` desde a F1 e escopo é congelado na emissão — **nenhum reprovision
 * por org é necessário**.
 *
 * ── `phone` é obrigatório e VALIDA o `subject` ─────────────────────────────
 *
 * O Max não é acreditado a afirmar quem é a pessoa. O servidor refaz o vínculo
 * telefone→sujeito; divergência é **403, não 200 com lista vazia**. Sem isso,
 * um token de tenant comprometido leria a carteira de qualquer usuário da org
 * apenas trocando o `subject`. Vazio significaria "não tem nada", que é uma
 * mentira operacional e some com o sinal de ataque.
 */

const subjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), userId: z.string().min(1) }),
  z.object({ kind: z.literal("broker"), splitRecipientId: z.string().min(1) }),
]);

const bodySchema = z.object({
  verb: z.enum(VERBOS_DE_LEITURA),
  subject: subjectSchema,
  phone: z.string().min(1),
  args: z
    .object({
      estado: z.string().min(1).optional(),
      limite: z.number().int().positive().optional(),
      negocio_id: z.string().min(1).optional(),
      proposta_id: z.string().min(1).optional(),
    })
    .optional()
    .default({}),
});

export const POST = withApi(
  "POST /api/agents/scope-query",
  async (req: NextRequest) => {
    const authed = await requireApiAuth(req, { scope: "agents:rw" });
    if (isAuthFailure(authed)) return authFailureResponse(authed);
    if (authed.ident.via !== "bearer") {
      return NextResponse.json(
        {
          error: "Forbidden",
          reason: "esta rota é máquina-a-máquina: use um token com agents:rw",
        },
        { status: 403 }
      );
    }
    const orgId = authed.org.id;

    const denied = await maxAgentRouteGate({
      orgId,
      via: authed.ident.via,
      agentKey: "max",
    });
    if (denied) return denied;

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Bad Request", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const body = parsed.data;

    const e164 = normalizeBrPhone(body.phone);
    if (!e164) {
      return NextResponse.json(
        { error: "Bad Request", reason: "phone não normalizável" },
        { status: 400 }
      );
    }

    const sujeito = await resolverSujeito({
      orgId,
      phone: e164,
      subject: body.subject,
    });
    if (!sujeito.ok) {
      // Um 403 só para "não resolveu" e "não confere". Distinguir os dois diria
      // a quem tem token de outra org se aquele telefone existe por aqui.
      return NextResponse.json(
        { error: "Forbidden", reason: "sujeito não confere com o telefone" },
        { status: 403 }
      );
    }

    const resultado = await executarVerbo({
      verb: body.verb,
      orgId,
      sujeito: sujeito.sujeito,
      args: body.args,
    });

    return NextResponse.json(resultado);
  }
);
