import { describe, it, expect } from "vitest";
import { STATUS_FILTERS, statusesForFilter } from "../list-filters";
import { proposalListWhereForFilter } from "../list-filters.server";
import { sendCanceledWhere, notSendCanceledWhere } from "../send-canceled-where";

describe("list-filters — split da parada de decisão (2026-08)", () => {
  it("'decisao' e 'proprietario' são filtros distintos", () => {
    expect(statusesForFilter("decisao")).toEqual(["assinada_proponente"]);
    expect(statusesForFilter("proprietario")).toEqual(["aguardando_vendedor"]);
  });

  it("'segunda_via_falhou' declara requiresServer e pré-filtra por status", () => {
    const opt = STATUS_FILTERS.find((f) => f.id === "segunda_via_falhou");
    expect(opt?.requiresServer).toBe(true);
    expect(opt?.statuses).toEqual(["aguardando_vendedor"]);
    // filterRequiresServer foi REMOVIDO (2026-08): exportado sem chamador de
    // produção — page.tsx sempre resolve via proposalListWhereForFilter. Um
    // caller futuro que o usasse pra um caminho "barato" (só statuses) mudaria
    // o comportamento dos filtros server-side em silêncio. O campo declarativo
    // continua e é o que se checa aqui.
    expect(STATUS_FILTERS.find((f) => f.id === "decisao")?.requiresServer).toBeFalsy();
  });

  it("where do servidor: 2ª via falhou = aguardando_vendedor sem via viva em NENHUM instrumento", () => {
    // Envelope reduzida vivo OU termo de Aceite vivo do vendedor contam como
    // "2ª via enviada" — proposta de Aceite com termo sent não pode cair aqui.
    expect(proposalListWhereForFilter("segunda_via_falhou")).toEqual({
      status: "aguardando_vendedor",
      envelopes: { none: { via: "reduzida", status: { in: ["running", "closed"] } } },
      signers: {
        none: {
          role: "vendedor",
          included: true,
          acceptanceClicksignId: { not: null },
          acceptanceStatus: { in: ["sent", "completed"] },
        },
      },
    });
  });

  it("where dos filtros por status continua um IN simples", () => {
    expect(proposalListWhereForFilter("cliente")).toEqual({
      status: { in: ["enviada", "entregue", "visualizada"] },
    });
    expect(proposalListWhereForFilter("all")).toEqual({});
    expect(proposalListWhereForFilter(undefined)).toEqual({});
  });

  it("'aberto' cobre a parada e a 2ª via (nada some do funil aberto)", () => {
    expect(statusesForFilter("aberto")).toEqual(
      expect.arrayContaining(["assinada_proponente", "aguardando_vendedor"])
    );
  });
});

describe("partição de falha_envio entre 'Rascunho / falha' e 'Envio cancelado' (2026-08)", () => {
  it("os dois chips declaram requiresServer e statuses SUPERSET do where", () => {
    // `statuses` é o pré-filtro RAW da busca `q` (page.tsx) — tem de ser
    // superset do where do servidor, senão a busca esconde o que o filtro
    // mostra. NÃO aperte o statuses pra casar com o where.
    const rasc = STATUS_FILTERS.find((f) => f.id === "rascunho");
    const canc = STATUS_FILTERS.find((f) => f.id === "envio_cancelado");
    expect(rasc?.requiresServer).toBe(true);
    expect(rasc?.statuses).toEqual(["rascunho", "falha_envio", "aguardando_aprovacao"]);
    expect(canc?.requiresServer).toBe(true);
    expect(canc?.statuses).toEqual(["falha_envio"]);
  });

  it("os dois wheres são o MESMO predicado, afirmado e negado", () => {
    // Partição total por construção: toda falha_envio cai em exatamente um.
    expect(proposalListWhereForFilter("envio_cancelado")).toEqual({
      status: "falha_envio",
      ...sendCanceledWhere(),
    });
    expect(proposalListWhereForFilter("rascunho")).toEqual({
      AND: [
        {
          OR: [
            { status: { in: ["rascunho", "aguardando_aprovacao"] } },
            { status: "falha_envio", ...notSendCanceledWhere() },
          ],
        },
      ],
    });
  });

  it("o predicado do chip é o do BADGE (evento), não sentAt", () => {
    // sentAt é monotônico: cancelar → reenviar → o reenvio falhar de verdade
    // deixa sentAt preenchido com badge VERMELHO. Um chip por sentAt mostraria
    // essa falha real sob "Envio cancelado" — o erro que o #337 já matou no
    // badge não pode renascer no filtro.
    const w = JSON.stringify(sendCanceledWhere());
    expect(w).toContain("primeira_via_canceled");
    expect(w).toContain("send_failed");
    expect(w).not.toContain("sentAt");
  });
});

describe("invariante da COMPOSIÇÃO com o escopo RBAC", () => {
  it("nenhum where de filtro usa chave que o spread da página sobrescreveria", () => {
    // page.tsx compõe `{ ...scope, kind, ...statusWhere, responsibleUserId, id }`
    // por SPREAD, e o escopo de VIEW_OWN_ONLY é `{ orgId, OR: [...] }`. Chave
    // repetida vence em silêncio — um filtro que devolvesse `OR` no topo
    // apagaria a restrição de propriedade e o corretor veria a org inteira.
    // Foi exatamente o bug que o gate pegou no chip de 2026-08-20.
    const PROIBIDAS = ["OR", "orgId", "userId", "kind", "responsibleUserId", "id"];
    for (const f of STATUS_FILTERS) {
      const keys = Object.keys(proposalListWhereForFilter(f.id));
      for (const k of PROIBIDAS) {
        expect(keys, `filtro '${f.id}' devolve chave proibida '${k}'`).not.toContain(k);
      }
    }
  });
});
