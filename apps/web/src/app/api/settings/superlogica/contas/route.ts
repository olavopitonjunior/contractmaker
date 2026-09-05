import { NextRequest, NextResponse } from "next/server";
import { requireSuperlogicaAdmin } from "@/lib/superlogica/settings-guard";
import { getOrgSuperlogicaCreds } from "@/lib/superlogica/account";
import { slGetV2, SuperlogicaError } from "@/lib/superlogica/client";

export const runtime = "nodejs";

interface CaixaMov {
  id_conta_cb?: string | null;
  st_descricao_cb?: string | null;
}

/** Páginas de 200 movimentos lidas no máximo (1.000 lançamentos recentes). */
const MAX_PAGES = 5;
const PAGE_SIZE = 200;

/**
 * GET /api/settings/superlogica/contas — contas bancárias da licença para o
 * select "Conta bancária das parcelas". A API v2 não expõe `contasbanco`
 * (404), então derivamos do `caixa`: distinct `id_conta_cb` + primeira
 * descrição não-vazia, ordenadas por quantidade de movimentos. Uma conta sem
 * movimento recente não aparece — por isso a tela também aceita o id à mão.
 */
export async function GET(req: NextRequest) {
  const gate = await requireSuperlogicaAdmin(req);
  if (!gate.ok) return gate.response;
  let creds;
  try {
    creds = await getOrgSuperlogicaCreds(gate.ctx.orgId);
  } catch (err) {
    console.error("[superlogica contas] falha ao decifrar credenciais:", err);
    return NextResponse.json(
      { error: "Falha interna ao ler as credenciais gravadas. Avise o suporte." },
      { status: 500 }
    );
  }
  if (!creds) {
    return NextResponse.json({ error: "Superlógica não conectada." }, { status: 409 });
  }
  try {
    const byId = new Map<number, { id: number; nome: string | null; movimentos: number }>();
    for (let pagina = 1; pagina <= MAX_PAGES; pagina++) {
      const movs = await slGetV2<CaixaMov>(creds, "caixa", {
        pagina,
        itensPorPagina: PAGE_SIZE,
      });
      for (const m of movs) {
        const id = Number(m.id_conta_cb);
        if (!Number.isFinite(id) || id <= 0) continue;
        const descricao = (m.st_descricao_cb ?? "").trim() || null;
        const cur = byId.get(id) ?? { id, nome: null, movimentos: 0 };
        cur.movimentos += 1;
        if (!cur.nome && descricao) cur.nome = descricao;
        byId.set(id, cur);
      }
      if (movs.length < PAGE_SIZE) break;
    }
    const contas = [...byId.values()]
      .sort((a, b) => b.movimentos - a.movimentos)
      .map((c) => ({ id: c.id, nome: c.nome ?? `Conta ${c.id}`, movimentos: c.movimentos }));
    return NextResponse.json({ contas });
  } catch (err) {
    const message = err instanceof SuperlogicaError ? err.message : "Falha ao listar contas.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
