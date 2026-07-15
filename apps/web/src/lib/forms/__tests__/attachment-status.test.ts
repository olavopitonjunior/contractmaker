import { describe, it, expect } from "vitest";
import { mapAttachmentStatusToCard } from "../attachment-status";

// Regressão do bug RE/MAX Trio (2026-07-15): o upload fresco hardcodava
// "extracting" no card enquanto o servidor criava o anexo em "awaiting_user"
// sem enfileirar OCR — spinner "Analisando…" eterno, botão "Extrair com IA"
// nunca aparecia. Este helper é a fonte única de verdade dos três caminhos
// do DocumentosStep (hidratação, polling, upload).
describe("mapAttachmentStatusToCard", () => {
  it("awaiting_user → awaiting (OCR on-demand, mostra botão Extrair com IA)", () => {
    expect(mapAttachmentStatusToCard("awaiting_user", false)).toBe("awaiting");
    // Mesmo com fields (ex.: assignment salvo via PATCH), awaiting_user manda.
    expect(mapAttachmentStatusToCard("awaiting_user", true)).toBe("awaiting");
  });

  it("queued/extracting → extracting (spinner, worker em andamento)", () => {
    expect(mapAttachmentStatusToCard("queued", false)).toBe("extracting");
    expect(mapAttachmentStatusToCard("extracting", false)).toBe("extracting");
  });

  it("ready/failed passam direto", () => {
    expect(mapAttachmentStatusToCard("ready", true)).toBe("ready");
    expect(mapAttachmentStatusToCard("ready", false)).toBe("ready");
    expect(mapAttachmentStatusToCard("failed", false)).toBe("failed");
  });

  it("status desconhecido/ausente: fields decide (rows legadas)", () => {
    expect(mapAttachmentStatusToCard(null, true)).toBe("ready");
    expect(mapAttachmentStatusToCard(undefined, false)).toBe("awaiting");
    expect(mapAttachmentStatusToCard("whatever", false)).toBe("awaiting");
    expect(mapAttachmentStatusToCard("whatever", true)).toBe("ready");
  });

  it("nunca retorna 'extracting' pra um doc que o servidor não está processando", () => {
    for (const s of ["awaiting_user", "ready", "failed", null, undefined]) {
      expect(mapAttachmentStatusToCard(s as never, false)).not.toBe("extracting");
    }
  });
});
