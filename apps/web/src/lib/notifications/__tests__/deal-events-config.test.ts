import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { resolveEffectiveNotificationConfig } from "../deal-events-config";

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
