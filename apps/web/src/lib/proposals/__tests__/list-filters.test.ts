import { describe, it, expect } from "vitest";
import { STATUS_FILTERS, statusesForFilter } from "../list-filters";
import {
  proposalListWhereForFilter,
  filterRequiresServer,
} from "../list-filters.server";

describe("list-filters — split da parada de decisão (2026-08)", () => {
  it("'decisao' e 'proprietario' são filtros distintos", () => {
    expect(statusesForFilter("decisao")).toEqual(["assinada_proponente"]);
    expect(statusesForFilter("proprietario")).toEqual(["aguardando_vendedor"]);
  });

  it("'segunda_via_falhou' declara requiresServer e pré-filtra por status", () => {
    const opt = STATUS_FILTERS.find((f) => f.id === "segunda_via_falhou");
    expect(opt?.requiresServer).toBe(true);
    expect(opt?.statuses).toEqual(["aguardando_vendedor"]);
    expect(filterRequiresServer("segunda_via_falhou")).toBe(true);
    expect(filterRequiresServer("decisao")).toBe(false);
  });

  it("where do servidor: 2ª via falhou = aguardando_vendedor SEM reduzida viva", () => {
    expect(proposalListWhereForFilter("segunda_via_falhou")).toEqual({
      status: "aguardando_vendedor",
      envelopes: { none: { via: "reduzida", status: { in: ["running", "closed"] } } },
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
