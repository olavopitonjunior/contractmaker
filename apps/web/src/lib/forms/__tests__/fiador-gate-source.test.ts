import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Guarda estrutural (mesmo padrão de finalize-gate-recebimento.test.ts): o
 * piso "garantia por fiador exige o fiador nomeado" tem de existir nos DOIS
 * lados, sempre pela mesma função (`missingFiadorName`), para o wizard e o
 * servidor nunca discordarem — o form público é burlável, então o que vale é o
 * 422 da rota; o wizard só evita a viagem.
 *
 * Teste de FONTE: renderizar o wizard inteiro ou subir a rota com Prisma
 * mockado custaria caro para afirmar duas ligações de uma linha. A regra em si
 * está coberta em garantia-fiador-flip.test.ts.
 */

function ler(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("piso do fiador — wizard e rota de finalize usam missingFiadorName", () => {
  it("LocacaoFormWizard bloqueia o avanço da etapa 5", () => {
    const src = ler("src/components/forms/LocacaoFormWizard.tsx");
    expect(src).toContain('from "@/lib/forms/garantia-fiador-flip"');
    expect(src).toMatch(/step === 5[\s\S]{0,200}missingFiadorName\(/);
  });

  it("PATCH /api/locacao/forms/[token] devolve 422 fiador_incompleto no finalize", () => {
    const src = ler("src/app/api/locacao/forms/[token]/route.ts");
    expect(src).toContain('from "@/lib/forms/garantia-fiador-flip"');
    const idx = src.indexOf("missingFiadorName(preview)");
    expect(idx).toBeGreaterThan(-1);
    const bloco = src.slice(idx, idx + 600);
    expect(bloco).toContain('reason: "fiador_incompleto"');
    expect(bloco).toContain("status: 422");
    // Roda dentro do bloco do finalize, depois do preset de obrigatoriedade.
    expect(src.indexOf("required_fields_missing")).toBeLessThan(idx);
  });
});
