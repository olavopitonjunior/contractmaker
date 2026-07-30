import { describe, it, expect } from "vitest";
import { changeLogAuthorLabel } from "../ChangeLogPanel";

describe("changeLogAuthorLabel", () => {
  it("source ai → IA, mesmo com userId (o usuário pediu, a IA escreveu)", () => {
    expect(
      changeLogAuthorLabel({
        source: "ai",
        user: { name: "Olavo", email: "o@x.com" },
      })
    ).toBe("IA");
  });

  it("source user com nome → nome", () => {
    expect(
      changeLogAuthorLabel({
        source: "user",
        user: { name: "Olavo", email: "o@x.com" },
      })
    ).toBe("Olavo");
  });

  it("source user sem nome → e-mail", () => {
    expect(
      changeLogAuthorLabel({ source: "user", user: { name: null, email: "o@x.com" } })
    ).toBe("o@x.com");
  });

  it("source user SEM userId → admite não saber (não é 'Sistema')", () => {
    expect(changeLogAuthorLabel({ source: "user", user: null })).toBe(
      "Manual (autor não identificado)"
    );
    expect(changeLogAuthorLabel({ source: "user" })).toBe(
      "Manual (autor não identificado)"
    );
  });

  it("source system → Sistema, mesmo com userId de gatilho", () => {
    expect(
      changeLogAuthorLabel({
        source: "system",
        user: { name: "Olavo", email: "o@x.com" },
      })
    ).toBe("Sistema");
    expect(changeLogAuthorLabel({ source: "system", user: null })).toBe("Sistema");
  });
});
