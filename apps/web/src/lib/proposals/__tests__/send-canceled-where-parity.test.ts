import { describe, it, expect } from "vitest";
import { sendCanceledWhere, notSendCanceledWhere } from "../send-canceled-where";
import { lastSendOutcomeIsCancel, SEND_OUTCOME_EVENTS } from "../status-sets";

/**
 * Paridade entre o WHERE do chip "Envio cancelado" e o BADGE âmbar.
 *
 * O badge lê "o último evento de SEND_OUTCOME_EVENTS é primeira_via_canceled".
 * O where não consegue expressar "último" e usa a aproximação conservadora
 * "existe cancelamento E não existe falha". Este teste avalia OS DOIS sobre os
 * mesmos históricos e fixa: (a) concordância em todo caso alcançável hoje;
 * (b) a única divergência possível é o chip OMITIR — nunca mostrar uma falha
 * real sob "Envio cancelado".
 */

/** Avalia o where do chip contra um histórico de eventos (ordem cronológica). */
function whereMatches(events: string[]): boolean {
  const w = sendCanceledWhere();
  const someCancel = events.includes(
    (w.events as { some: { eventName: string } }).some.eventName
  );
  const noneFailed = !events.includes(
    (w.NOT as { events: { some: { eventName: string } } }).events.some.eventName
  );
  return someCancel && noneFailed;
}

/** O que o badge responde para o mesmo histórico. */
function badgeSaysCancel(events: string[]): boolean {
  const outcomes = events.filter((e) =>
    (SEND_OUTCOME_EVENTS as readonly string[]).includes(e)
  );
  return lastSendOutcomeIsCancel(outcomes.at(-1) ?? null);
}

describe("where do chip ↔ badge âmbar", () => {
  it.each([
    [[], "nunca teve desfecho (falha antiga sem rastro)"],
    [["primeira_via_canceled"], "cancelamento simples"],
    [["send_failed"], "falha real simples"],
    [["primeira_via_canceled", "send_failed"], "cancelou → reenviou → reenvio falhou"],
    [["assignee_changed", "primeira_via_canceled", "manual_sync"], "cancelamento com ruído em volta"],
  ] as [string[], string][])("concordam: %j (%s)", (events) => {
    expect(whereMatches(events)).toBe(badgeSaysCancel(events));
  });

  it("única divergência: falhou → reenviou → cancelou (chip OMITE, badge diz cancelado)", () => {
    // Sob o invariante de CAS os dois desfechos não coexistem; se um dia
    // coexistirem nesta ordem, o chip perde a proposta — erro por OMISSÃO, o
    // lado certo. Se este teste quebrar porque alguém "consertou" o where pra
    // incluir o caso, confira que a mudança não reincluiu o caso do teste
    // anterior (cancelou → falhou), que é falha REAL e não pode entrar.
    const events = ["send_failed", "primeira_via_canceled"];
    expect(badgeSaysCancel(events)).toBe(true);
    expect(whereMatches(events)).toBe(false); // omissão conservadora
  });

  it("o caso que proibiu sentAt como discriminador", () => {
    // cancelou → reenviou → falhou: sentAt está preenchido (monotônico), badge
    // é VERMELHO. O chip não pode mostrar essa proposta.
    expect(whereMatches(["primeira_via_canceled", "send_failed"])).toBe(false);
  });
});

describe("notSendCanceledWhere é a negação EXATA (partição total)", () => {
  // De Morgan à mão em vez de `NOT: sendCanceledWhere()` — a semântica do NOT
  // do Prisma sobre objeto composto não é documentada, e errar aqui faria a
  // falha_envio sem evento nenhum sumir dos DOIS chips.
  // Derivado do OBJETO REAL, como whereMatches — não de literais copiados.
  // Com literais, inverter o De Morgan em send-canceled-where.ts deixava a
  // suíte inteira verde: o XOR provava a cópia, não a função.
  function notWhereMatches(events: string[]): boolean {
    const w = notSendCanceledWhere();
    const branches = w.OR as Array<Record<string, unknown>>;
    return branches.some((b) => {
      const ev = b.events as { none?: { eventName: string }; some?: { eventName: string } };
      if (ev.none) return !events.includes(ev.none.eventName);
      if (ev.some) return events.includes(ev.some.eventName);
      throw new Error("forma inesperada em notSendCanceledWhere");
    });
  }

  it("XOR em todos os históricos: toda falha_envio cai em exatamente um chip", () => {
    const historicos: string[][] = [
      [],
      ["primeira_via_canceled"],
      ["send_failed"],
      ["primeira_via_canceled", "send_failed"],
      ["send_failed", "primeira_via_canceled"],
      ["assignee_changed"],
      ["assignee_changed", "primeira_via_canceled", "manual_sync"],
    ];
    for (const h of historicos) {
      expect(whereMatches(h) !== notWhereMatches(h), JSON.stringify(h)).toBe(true);
    }
  });

  it("falha antiga SEM evento nenhum fica no 'Rascunho / falha' — não some", () => {
    // O caso que a negação errada perderia: proposta que caiu em falha_envio
    // antes de send_failed existir. [] tem de casar com a negação.
    expect(notWhereMatches([])).toBe(true);
    expect(whereMatches([])).toBe(false);
  });
});
