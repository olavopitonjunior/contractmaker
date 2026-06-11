import { describe, it, expect } from "vitest";
import {
  canTransitionInspection,
  isInspectionContentEditable,
  INSPECTION_STATUSES,
} from "../inspection-types";
import { inspectionUpdateSchema } from "../validators";

describe("inspection — workflow do laudo", () => {
  describe("canTransitionInspection", () => {
    it("segue o caminho feliz rascunho→em_campo→laudo_gerado→assinatura→concluida", () => {
      expect(canTransitionInspection("rascunho", "em_campo")).toBe(true);
      expect(canTransitionInspection("em_campo", "laudo_gerado")).toBe(true);
      expect(canTransitionInspection("laudo_gerado", "assinatura")).toBe(true);
    });

    it("permite regressão só pra reabrir edição antes da conclusão", () => {
      expect(canTransitionInspection("em_campo", "rascunho")).toBe(true);
      expect(canTransitionInspection("laudo_gerado", "em_campo")).toBe(true);
      expect(canTransitionInspection("assinatura", "laudo_gerado")).toBe(true);
    });

    it("bloqueia saltos e saída de concluida", () => {
      expect(canTransitionInspection("rascunho", "laudo_gerado")).toBe(false);
      expect(canTransitionInspection("rascunho", "concluida")).toBe(false);
      expect(canTransitionInspection("em_campo", "assinatura")).toBe(false);
      for (const to of INSPECTION_STATUSES) {
        if (to !== "concluida") {
          expect(canTransitionInspection("concluida", to)).toBe(false);
        }
      }
    });

    it("é idempotente (from === to)", () => {
      for (const s of INSPECTION_STATUSES) {
        expect(canTransitionInspection(s, s)).toBe(true);
      }
    });
  });

  describe("isInspectionContentEditable", () => {
    it("permite edição até laudo_gerado, bloqueia em assinatura/concluida", () => {
      expect(isInspectionContentEditable("rascunho")).toBe(true);
      expect(isInspectionContentEditable("em_campo")).toBe(true);
      expect(isInspectionContentEditable("laudo_gerado")).toBe(true);
      expect(isInspectionContentEditable("assinatura")).toBe(false);
      expect(isInspectionContentEditable("concluida")).toBe(false);
    });
  });

  describe("inspectionUpdateSchema", () => {
    it("aceita laudo completo (ambientes + meta)", () => {
      const r = inspectionUpdateSchema.safeParse({
        ambientesJson: [
          {
            id: "a1",
            nome: "Sala",
            ordem: 0,
            fotos: [{ url: "https://blob.example/f1.jpg", uploadedAt: "2026-06-11T12:00:00Z" }],
            itens: [
              {
                id: "i1",
                nome: "Piso",
                estado: "bom",
                observacoes: "risco leve perto da porta",
                fotos: [],
              },
            ],
          },
        ],
        checklistJson: {
          medidores: { agua: { leitura: "1234.5" }, luz: { leitura: "98765" } },
          chaves: [{ tipo: "porta externa", quantidade: 2 }],
          mobilia: [{ item: "armário cozinha", quantidade: 1, estado: "bom" }],
          observacoesGerais: "imóvel limpo",
          prazoContestacaoDias: 7,
        },
      });
      expect(r.success).toBe(true);
    });

    it("rejeita estado de item fora do enum", () => {
      const r = inspectionUpdateSchema.safeParse({
        ambientesJson: [
          {
            id: "a1",
            nome: "Sala",
            ordem: 0,
            itens: [{ id: "i1", nome: "Piso", estado: "pessimo", fotos: [] }],
          },
        ],
      });
      expect(r.success).toBe(false);
    });

    it("rejeita foto com url inválida", () => {
      const r = inspectionUpdateSchema.safeParse({
        ambientesJson: [
          {
            id: "a1",
            nome: "Sala",
            ordem: 0,
            fotos: [{ url: "not-a-url", uploadedAt: "2026-06-11" }],
            itens: [],
          },
        ],
      });
      expect(r.success).toBe(false);
    });
  });
});
