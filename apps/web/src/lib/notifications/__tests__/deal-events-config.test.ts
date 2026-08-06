import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  DEAL_NOTIF_EVENTS,
  PARTY_CAPABLE_EVENTS,
  isPartyCapableEvent,
  resolveEffectiveNotificationConfig,
} from "../deal-events-config";

const orgSettingsFind = prisma.orgNotificationSettings
  .findUnique as unknown as ReturnType<typeof vi.fn>;

describe("resolveEffectiveNotificationConfig — merge defaults ← org ← deal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sem org settings nem deal → defaults de código (email on, whatsapp off)", async () => {
    orgSettingsFind.mockResolvedValue(null);
    const cfg = await resolveEffectiveNotificationConfig("org1");
    expect(cfg.events.stage_change.broker).toEqual({
      email: true,
      whatsapp: false,
    });
    expect(cfg.events.charge_paid.broker.email).toBe(true);
    expect(cfg.formReminder).toEqual({ enabled: true, days: [2, 5] });
    expect(cfg.muted).toBe(false);
    expect(cfg.brokerIds).toEqual([]);
  });

  it("org desliga email de stage_change; demais eventos herdam default", async () => {
    orgSettingsFind.mockResolvedValue({
      settingsJson: {
        events: { stage_change: { broker: { email: false } } },
      },
    });
    const cfg = await resolveEffectiveNotificationConfig("org1");
    expect(cfg.events.stage_change.broker.email).toBe(false);
    // whatsapp da mesma linha herda o default (chave ausente ≠ false explícito)
    expect(cfg.events.stage_change.broker.whatsapp).toBe(false);
    expect(cfg.events.form_completed.broker.email).toBe(true);
  });

  it("deal override vence a org; chave ausente no deal herda da org", async () => {
    orgSettingsFind.mockResolvedValue({
      settingsJson: {
        events: {
          stage_change: { broker: { email: false } },
          charge_paid: { broker: { whatsapp: true } },
        },
      },
    });
    const cfg = await resolveEffectiveNotificationConfig("org1", {
      events: { stage_change: { broker: { email: true } } },
      brokerIds: ["sr1"],
      muted: true,
    });
    expect(cfg.events.stage_change.broker.email).toBe(true); // deal religou
    expect(cfg.events.charge_paid.broker.whatsapp).toBe(true); // herdado da org
    expect(cfg.brokerIds).toEqual(["sr1"]);
    expect(cfg.muted).toBe(true);
  });

  it("formReminder da org: days inválidos são filtrados; vazio cai no default", async () => {
    orgSettingsFind.mockResolvedValue({
      settingsJson: { formReminder: { enabled: false, days: [3, 0, 99, 7] } },
    });
    const cfg = await resolveEffectiveNotificationConfig("org1");
    expect(cfg.formReminder.enabled).toBe(false);
    expect(cfg.formReminder.days).toEqual([3, 7]);
  });

  it("erro de DB nas settings da org → defaults (nunca lança)", async () => {
    orgSettingsFind.mockRejectedValue(new Error("db down"));
    const cfg = await resolveEffectiveNotificationConfig("org1");
    expect(cfg.events.contract_signed.broker.email).toBe(true);
  });

  it("json malformado (string/array) é ignorado sem lançar", async () => {
    orgSettingsFind.mockResolvedValue({ settingsJson: "corrompido" });
    const cfg = await resolveEffectiveNotificationConfig("org1", 42);
    expect(cfg.events.form_reminder.broker.email).toBe(true);
  });
});

describe("público party — defaults OFF e allowlist de eventos", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a allowlist é exatamente contract_signed + charge_created", () => {
    expect([...PARTY_CAPABLE_EVENTS]).toEqual([
      "contract_signed",
      "charge_created",
    ]);
    expect(isPartyCapableEvent("contract_signed")).toBe(true);
    expect(isPartyCapableEvent("stage_change")).toBe(false);
  });

  it("sem config nenhuma, TODO evento nasce com party desligado", async () => {
    orgSettingsFind.mockResolvedValue(null);
    const cfg = await resolveEffectiveNotificationConfig("org1");
    for (const ev of DEAL_NOTIF_EVENTS) {
      expect(cfg.events[ev].party).toEqual({ email: false, whatsapp: false });
    }
  });

  it("org liga party num evento da allowlist → vale", async () => {
    orgSettingsFind.mockResolvedValue({
      settingsJson: {
        events: { charge_created: { party: { email: true } } },
      },
    });
    const cfg = await resolveEffectiveNotificationConfig("org1");
    expect(cfg.events.charge_created.party).toEqual({
      email: true,
      whatsapp: false,
    });
    // não contamina o público irmão
    expect(cfg.events.charge_created.broker.email).toBe(true);
  });

  it("config velha ligando party FORA da allowlist é zerada pelo resolver", async () => {
    orgSettingsFind.mockResolvedValue({
      settingsJson: {
        events: {
          stage_change: { party: { email: true, whatsapp: true } },
          contract_ready: { party: { email: true } },
        },
      },
    });
    const cfg = await resolveEffectiveNotificationConfig("org1", {
      events: { form_completed: { party: { whatsapp: true } } },
    });
    expect(cfg.events.stage_change.party).toEqual({
      email: false,
      whatsapp: false,
    });
    expect(cfg.events.contract_ready.party.email).toBe(false);
    expect(cfg.events.form_completed.party.whatsapp).toBe(false);
  });

  it("deal pode DESLIGAR party que a org ligou (override na allowlist)", async () => {
    orgSettingsFind.mockResolvedValue({
      settingsJson: {
        events: { contract_signed: { party: { email: true, whatsapp: true } } },
      },
    });
    const cfg = await resolveEffectiveNotificationConfig("org1", {
      events: { contract_signed: { party: { whatsapp: false } } },
    });
    expect(cfg.events.contract_signed.party).toEqual({
      email: true,
      whatsapp: false,
    });
  });
});

// ── Público manager (v3) ────────────────────────────────────────────────────
//
// Espelho invertido do party: o gerente é operador designado pela imobiliária
// (mesmo racional do corretor), então nasce LIGADO nos dois canais e SEM
// allowlist de eventos. Quem não quer desliga na matriz da org.

describe("público manager — default ON e sem allowlist", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sem config nenhuma, todo MARCO nasce com manager ligado nos 2 canais (SLA é a exceção: nasce OFF)", async () => {
    orgSettingsFind.mockResolvedValue(null);
    const cfg = await resolveEffectiveNotificationConfig("org1");
    for (const ev of DEAL_NOTIF_EVENTS) {
      if (ev === "deal_sla_breached") continue;
      expect(cfg.events[ev].manager).toEqual({ email: true, whatsapp: true });
    }
    // DEFAULT_EVENT_OVERRIDES: alerta de SLA é operacional (sino via cron) —
    // canal externo só se a org ligar na matriz.
    expect(cfg.events.deal_sla_breached.broker).toEqual({
      email: false,
      whatsapp: false,
    });
    expect(cfg.events.deal_sla_breached.manager).toEqual({
      email: false,
      whatsapp: false,
    });
  });

  it("org consegue LIGAR o evento de SLA na matriz (override é default, não trava)", async () => {
    orgSettingsFind.mockResolvedValue({
      settingsJson: {
        events: { deal_sla_breached: { manager: { email: true } } },
      },
    });
    const cfg = await resolveEffectiveNotificationConfig("org1");
    expect(cfg.events.deal_sla_breached.manager.email).toBe(true);
    expect(cfg.events.deal_sla_breached.manager.whatsapp).toBe(false);
  });

  it("manager vale em evento FORA da allowlist de party — não há zeramento", async () => {
    orgSettingsFind.mockResolvedValue(null);
    const cfg = await resolveEffectiveNotificationConfig("org1");
    expect(isPartyCapableEvent("stage_change")).toBe(false);
    expect(cfg.events.stage_change.manager.email).toBe(true);
    expect(cfg.events.stage_change.party.email).toBe(false);
  });

  it("org desliga UM canal do manager; o irmão sobrevive (merge por canal)", async () => {
    orgSettingsFind.mockResolvedValue({
      settingsJson: {
        events: { stage_change: { manager: { whatsapp: false } } },
      },
    });
    const cfg = await resolveEffectiveNotificationConfig("org1");
    expect(cfg.events.stage_change.manager).toEqual({
      email: true,
      whatsapp: false,
    });
    // não contamina os públicos irmãos nem os outros eventos
    expect(cfg.events.stage_change.broker.email).toBe(true);
    expect(cfg.events.contract_ready.manager.whatsapp).toBe(true);
  });

  it("org desliga os dois canais → manager off naquele evento", async () => {
    orgSettingsFind.mockResolvedValue({
      settingsJson: {
        events: { charge_paid: { manager: { email: false, whatsapp: false } } },
      },
    });
    const cfg = await resolveEffectiveNotificationConfig("org1");
    expect(cfg.events.charge_paid.manager).toEqual({
      email: false,
      whatsapp: false,
    });
  });

  /**
   * O override por deal não expõe `manager` na API — mas o merge precisa
   * preservar o que a org configurou, senão mexer no toggle do corretor
   * religaria o gerente que a imobiliária tinha desligado.
   */
  it("override de deal sem chave manager preserva o que a org desligou", async () => {
    orgSettingsFind.mockResolvedValue({
      settingsJson: {
        events: { stage_change: { manager: { email: false, whatsapp: false } } },
      },
    });
    const cfg = await resolveEffectiveNotificationConfig("org1", {
      events: { stage_change: { broker: { email: false } } },
    });
    expect(cfg.events.stage_change.manager).toEqual({
      email: false,
      whatsapp: false,
    });
    expect(cfg.events.stage_change.broker.email).toBe(false);
  });
});
