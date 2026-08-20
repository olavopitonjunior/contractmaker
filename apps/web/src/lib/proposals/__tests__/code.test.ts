import { describe, it, expect, vi } from "vitest";
import {
  formatProposalCode,
  proposalSequenceScope,
  proposalNumero,
  allocateProposalCode,
} from "../code";

describe("formatProposalCode", () => {
  it("zera à esquerda até 4 dígitos", () => {
    expect(formatProposalCode(2026, 1)).toBe("PROP-2026-0001");
    expect(formatProposalCode(2026, 42)).toBe("PROP-2026-0042");
    expect(formatProposalCode(2026, 9999)).toBe("PROP-2026-9999");
  });

  it("passa de 9999 sem truncar nem colidir", () => {
    // O padStart só para de preencher — o código cresce e segue único/ordenável.
    expect(formatProposalCode(2026, 10000)).toBe("PROP-2026-10000");
  });
});

describe("proposalSequenceScope", () => {
  it("separa o contador por ano", () => {
    expect(proposalSequenceScope(2026)).toBe("proposal:2026");
    expect(proposalSequenceScope(2027)).toBe("proposal:2027");
  });
});

describe("proposalNumero", () => {
  it("usa o código quando existe", () => {
    expect(proposalNumero({ code: "PROP-2026-0042", id: "clx0000abcdef123" })).toBe(
      "PROP-2026-0042"
    );
  });

  it("cai no sufixo do id em proposta anterior ao backfill", () => {
    expect(proposalNumero({ code: null, id: "clx0000abcdef123" })).toBe("bcdef123");
  });
});

describe("allocateProposalCode", () => {
  /** Fake mínimo do contrato `$queryRaw` usado pelo alocador. */
  function db(values: number[]) {
    const queue = [...values];
    return {
      $queryRaw: vi.fn(async () => [{ value: queue.shift() }]),
    };
  }

  it("formata o valor devolvido pelo contador com o ano BRT", async () => {
    const d = db([42]);
    // 12h UTC em julho → mesmo dia em São Paulo, ano 2026.
    const code = await allocateProposalCode(d, "org-1", new Date("2026-07-15T12:00:00Z"));
    expect(code).toBe("PROP-2026-0042");
  });

  it("usa o ano de SÃO PAULO, não o do runtime em UTC", async () => {
    // 01/01/2027 01:00 UTC = 31/12/2026 22:00 em São Paulo. O contador tem de
    // continuar em 2026 — senão a virada do ano acontece 3h cedo e a numeração
    // pula de série no meio da noite de 31 de dezembro.
    const d = db([9]);
    const code = await allocateProposalCode(d, "org-1", new Date("2027-01-01T01:00:00Z"));
    expect(code).toBe("PROP-2026-0009");
    expect(d.$queryRaw).toHaveBeenCalledOnce();
  });

  it("dois creates concorrentes recebem números distintos", async () => {
    // O contador serializa no Postgres (ON CONFLICT DO UPDATE ... RETURNING);
    // aqui o fake devolve valores sucessivos pra provar que o código só reflete
    // o que o banco entregou — nunca um MAX+1 calculado na aplicação.
    const d = db([1, 2]);
    const [a, b] = await Promise.all([
      allocateProposalCode(d, "org-1", new Date("2026-03-01T12:00:00Z")),
      allocateProposalCode(d, "org-1", new Date("2026-03-01T12:00:00Z")),
    ]);
    expect(new Set([a, b]).size).toBe(2);
    expect([a, b].sort()).toEqual(["PROP-2026-0001", "PROP-2026-0002"]);
  });

  it("explode quando o contador não devolve linha (em vez de gravar código torto)", async () => {
    const d = { $queryRaw: vi.fn(async () => [] as { value: number }[]) };
    await expect(
      allocateProposalCode(d, "org-1", new Date("2026-03-01T12:00:00Z"))
    ).rejects.toThrow(/código/i);
  });
});
