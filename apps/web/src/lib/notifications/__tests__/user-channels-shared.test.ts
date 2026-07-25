import { describe, it, expect } from "vitest";
import {
  orgSelectedUserIds,
  prefAllows,
  USER_NOTIF_CHANNELS,
} from "../user-channels-shared";
import { USER_CHANNEL_REGISTRY } from "../user-channels-registry";

/**
 * O que estes testes protegem: a matriz nova (por tipo) convive com a forma
 * antiga (por categoria) SEM backfill. Se a precedência ou a coerção
 * quebrarem, a configuração que já está em produção deixa de valer em
 * silêncio — ninguém percebe até alguém reclamar que parou de receber.
 */

describe("prefAllows — precedência tipo sobre categoria", () => {
  it("sem nada configurado, não recebe", () => {
    expect(prefAllows({}, "form_completed", "whatsapp", "deal_updates")).toBe(false);
    expect(prefAllows(null, "form_completed", "email", "deal_updates")).toBe(false);
  });

  it("a categoria liga todos os tipos dela", () => {
    const p = { events: { deal_updates: { whatsapp: true } } };
    expect(prefAllows(p, "form_completed", "whatsapp", "deal_updates")).toBe(true);
    expect(prefAllows(p, "deal_stage_change", "whatsapp", "deal_updates")).toBe(true);
  });

  it("o tipo VENCE a categoria — é o que permite 'a categoria menos este'", () => {
    const p = {
      events: { deal_updates: { whatsapp: true } },
      types: { deal_form_reminder: { whatsapp: false } },
    };
    expect(prefAllows(p, "form_completed", "whatsapp", "deal_updates")).toBe(true);
    expect(prefAllows(p, "deal_form_reminder", "whatsapp", "deal_updates")).toBe(false);
  });

  it("o tipo também liga sozinho, sem a categoria", () => {
    const p = { types: { form_completed: { email: true } } };
    expect(prefAllows(p, "form_completed", "email", "deal_updates")).toBe(true);
    expect(prefAllows(p, "form_completed", "whatsapp", "deal_updates")).toBe(false);
  });

  it("canais são independentes", () => {
    const p = { types: { form_completed: { email: true, whatsapp: false } } };
    expect(prefAllows(p, "form_completed", "email", "deal_updates")).toBe(true);
    expect(prefAllows(p, "form_completed", "whatsapp", "deal_updates")).toBe(false);
  });
});

describe("orgSelectedUserIds — quem tem alcance org-wide", () => {
  it("forma nova", () => {
    expect(orgSelectedUserIds({ userRecipients: { users: ["a", "b"] } })).toEqual(["a", "b"]);
  });

  it("forma LEGADA por categoria continua valendo — é o que está em produção", () => {
    const legado = { userRecipients: { events: { deal_updates: ["marcia"] } } };
    expect(orgSelectedUserIds(legado)).toEqual(["marcia"]);
  });

  it("as duas formas somam, sem duplicar", () => {
    const misto = {
      userRecipients: { users: ["marcia"], events: { deal_updates: ["marcia", "ana"] } },
    };
    expect(orgSelectedUserIds(misto).sort()).toEqual(["ana", "marcia"]);
  });

  it("lixo não quebra e não vira destinatário", () => {
    expect(orgSelectedUserIds(null)).toEqual([]);
    expect(orgSelectedUserIds({})).toEqual([]);
    expect(orgSelectedUserIds({ userRecipients: "nao-e-objeto" })).toEqual([]);
    expect(orgSelectedUserIds({ userRecipients: { users: [1, "", null, "ok"] } })).toEqual(["ok"]);
  });
});

describe("registry — rótulo obrigatório", () => {
  it("todo tipo da allowlist tem rótulo legível", () => {
    // Sem isto a matriz mostraria linha em branco pro tipo novo.
    const semRotulo = Object.entries(USER_CHANNEL_REGISTRY)
      .filter(([, p]) => !p.label || p.label.trim() === "")
      .map(([t]) => t);
    expect(semRotulo).toEqual([]);
  });

  it("os canais configuráveis são e-mail e WhatsApp — o sino é sempre org-wide", () => {
    expect([...USER_NOTIF_CHANNELS]).toEqual(["email", "whatsapp"]);
  });
});
