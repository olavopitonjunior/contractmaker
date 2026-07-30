import { describe, it, expect } from "vitest";
import {
  formatDateTimeBR,
  formatDateBR,
  formatDayMonthBR,
  deadlineBR,
  toDate,
} from "../datetime";

// O ponto destes testes é o mesmo de money.test.ts: a saída tem que ser um
// literal EXATO, não "o que o ICU deste runtime achar". Se alguém trocar a
// implementação por `toLocaleString("pt-BR", { dateStyle, timeStyle })`, a cola
// entre data e hora vira ", " em ICU novo e " " em ICU velho — e um dos dois
// quebra aqui antes de quebrar a hidratação em produção (React #418/#423).

describe("formatDateTimeBR", () => {
  it.each([
    // [ISO UTC, esperado em America/Sao_Paulo]
    ["2026-07-28T23:23:00Z", "28/07/2026 20:23"],
    ["2026-07-28T00:30:00Z", "27/07/2026 21:30"], // vira o dia pra trás
    ["2026-01-01T02:59:00Z", "31/12/2025 23:59"], // vira o ano pra trás
    ["2026-07-28T03:00:00Z", "28/07/2026 00:00"], // meia-noite BRT = "00", nunca "24"
    ["2026-07-28T14:05:09Z", "28/07/2026 11:05"], // segundos não aparecem
  ])("%s → %s", (iso, expected) => {
    expect(formatDateTimeBR(iso)).toBe(expected);
  });

  it("aceita Date e epoch ms além de string", () => {
    const iso = "2026-07-28T23:23:00Z";
    expect(formatDateTimeBR(new Date(iso))).toBe("28/07/2026 20:23");
    expect(formatDateTimeBR(new Date(iso).getTime())).toBe("28/07/2026 20:23");
  });

  it("cobre o horário de verão histórico (pré-2019, quando o Brasil ainda tinha)", () => {
    // 2018-01-15T02:30Z: BRST era UTC-2 → 00:30 do dia 15, não 23:30 do dia 14.
    // Um offset -03:00 chumbado erraria isto; a tabela IANA acerta.
    expect(formatDateTimeBR("2018-01-15T02:30:00Z")).toBe("15/01/2018 00:30");
  });

  it("não formata o que não é data", () => {
    expect(formatDateTimeBR(null)).toBe("—");
    expect(formatDateTimeBR(undefined)).toBe("—");
    expect(formatDateTimeBR("")).toBe("—");
    expect(formatDateTimeBR("nem data")).toBe("—");
    expect(formatDateTimeBR(null, "")).toBe("");
  });
});

describe("formatDateBR / formatDayMonthBR", () => {
  it("corta a hora mantendo o dia do fuso de SP", () => {
    expect(formatDateBR("2026-07-28T23:23:00Z")).toBe("28/07/2026");
    expect(formatDateBR("2026-07-29T02:00:00Z")).toBe("28/07/2026");
    expect(formatDayMonthBR("2026-07-29T02:00:00Z")).toBe("28/07");
  });

  it("respeita o fallback pedido", () => {
    expect(formatDateBR(null)).toBe("—");
    expect(formatDayMonthBR(null, "")).toBe("");
  });
});

describe("deadlineBR", () => {
  const now = new Date("2026-07-28T12:00:00Z").getTime();
  const inDays = (d: number) => new Date(now + d * 86_400_000).toISOString();

  it("sem prazo", () => {
    expect(deadlineBR(null, now)).toEqual({
      days: null,
      tone: "none",
      label: "sem prazo",
      shortLabel: "—",
    });
  });

  it("vencida", () => {
    const r = deadlineBR(inDays(-1), now);
    expect(r.tone).toBe("danger");
    expect(r.label).toBe("vencida");
    expect(r.shortLabel).toBe("vencida");
  });

  it("vence hoje quando falta menos de um dia", () => {
    const r = deadlineBR(new Date(now + 3 * 3_600_000).toISOString(), now);
    expect(r.days).toBe(1); // Math.ceil de 0,125 dia
    expect(r.label).toBe("faltam 1d");
  });

  it("expira exatamente agora → vence hoje", () => {
    expect(deadlineBR(new Date(now).toISOString(), now)).toMatchObject({
      days: 0,
      tone: "danger",
      label: "vence hoje",
    });
  });

  it("≤2 dias vira warn; acima disso, neutro", () => {
    expect(deadlineBR(inDays(2), now)).toMatchObject({
      days: 2,
      tone: "warn",
      label: "faltam 2d",
      shortLabel: "2d",
    });
    expect(deadlineBR(inDays(5), now)).toMatchObject({
      days: 5,
      tone: "none",
      label: "faltam 5d",
      shortLabel: "5d",
    });
  });

  it("é puro em relação a `now` — mesma entrada, mesma saída", () => {
    // Esta é a propriedade que impede o mismatch: o server calcula e manda
    // pronto, então o rótulo não pode depender do relógio de quem renderiza.
    const a = deadlineBR(inDays(5), now);
    const b = deadlineBR(inDays(5), now);
    expect(a).toEqual(b);
    // …e um `now` 2 segundos depois (o intervalo típico SSR→hidratação) daria
    // outro rótulo se alguém recalculasse no client:
    const later = deadlineBR(new Date(now + 5 * 86_400_000).toISOString(), now + 2000);
    expect(later.days).toBe(5);
  });
});

describe("toDate", () => {
  it("normaliza os formatos aceitos e rejeita o resto", () => {
    expect(toDate("2026-07-28T00:00:00Z")?.toISOString()).toBe("2026-07-28T00:00:00.000Z");
    expect(toDate(0)?.getTime()).toBe(0);
    expect(toDate(null)).toBeNull();
    expect(toDate("")).toBeNull();
    expect(toDate("xx")).toBeNull();
  });
});
