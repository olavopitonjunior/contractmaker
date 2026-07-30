import { describe, expect, it } from "vitest";
import { slugify } from "@/lib/utils/slug";
import { formPublicPath } from "@/lib/forms/form-url";

describe("slugify", () => {
  it("remove acentos e vira kebab-case", () => {
    expect(slugify("Apto 102 — Ed. Solar")).toBe("apto-102-ed-solar");
    expect(slugify("Locação São João")).toBe("locacao-sao-joao");
  });

  it("colapsa separadores e apara hífens das pontas", () => {
    expect(slugify("  Casa -- da / Praia  ")).toBe("casa-da-praia");
  });

  it("retorna vazio quando nada sobra", () => {
    expect(slugify("🏠🔑")).toBe("");
    expect(slugify("---")).toBe("");
  });

  it("trunca em 60 chars sem hífen pendurado", () => {
    const slug = slugify(`${"a".repeat(59)} bcdef`);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("formPublicPath", () => {
  it("anexa o slug do título", () => {
    expect(formPublicPath("tok123", "Cód: 20477 – Apto Centro")).toBe(
      "/f/tok123/cod-20477-apto-centro"
    );
  });

  it("cai pro token puro sem título ou com título sem slug", () => {
    expect(formPublicPath("tok123")).toBe("/f/tok123");
    expect(formPublicPath("tok123", null)).toBe("/f/tok123");
    expect(formPublicPath("tok123", "🏠")).toBe("/f/tok123");
  });
});
