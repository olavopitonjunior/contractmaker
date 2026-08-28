import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Guarda estrutural: o gate dos dados de recebimento do corretor tem de rodar
 * no FINALIZE das duas esteiras.
 *
 * A Comissão é a ÚLTIMA etapa do wizard. O gate nasceu dentro da validação de
 * AVANÇO (`validateStep` / `validateAndNavigate`), que só roda ao passar de uma
 * etapa para a seguinte — e da última não se avança para lugar nenhum.
 * `handleFinalize` vai direto ao PATCH, sem passar por ela. Resultado: com a
 * exigência ligada, o formulário concluía sem os dados exigidos. Achado no
 * smoke de staging, não pelos testes — daí esta guarda.
 *
 * É um teste de FONTE, não de comportamento: renderizar os dois wizards
 * inteiros custaria caro para afirmar uma ligação de uma linha. O repo já usa
 * varredura de fonte para travar contratos assim (ver output-schemas.test).
 */

const WIZARDS = [
  {
    nome: "SalesFormWizard (venda)",
    arquivo: "SalesFormWizard.tsx",
    lista: "comissao.comissionados",
  },
  {
    nome: "LocacaoFormWizard (locação)",
    arquivo: "LocacaoFormWizard.tsx",
    lista: "comissao.angariadores",
  },
];

function lerWizard(arquivo: string): string {
  return fs.readFileSync(
    path.join(process.cwd(), "src/components/forms", arquivo),
    "utf8"
  );
}

/** Corpo de `handleFinalize` até o primeiro `await fetch` (o envio de fato). */
function corpoDoFinalize(fonte: string): string {
  const inicio = fonte.indexOf("const handleFinalize = async ()");
  expect(inicio, "handleFinalize não encontrado").toBeGreaterThan(-1);
  const envio = fonte.indexOf("await fetch(", inicio);
  expect(envio, "envio do finalize não encontrado").toBeGreaterThan(inicio);
  return fonte.slice(inicio, envio);
}

describe("gate de recebimento do corretor no finalize", () => {
  for (const w of WIZARDS) {
    it(`${w.nome}: handleFinalize consulta o gate ANTES de enviar`, () => {
      const corpo = corpoDoFinalize(lerWizard(w.arquivo));
      expect(corpo).toContain("gateRecebimentoOk()");
    });

    it(`${w.nome}: o gate lê a lista de comissionados da própria esteira`, () => {
      const fonte = lerWizard(w.arquivo);
      const inicio = fonte.indexOf("const gateRecebimentoOk");
      expect(inicio, "gateRecebimentoOk não declarado").toBeGreaterThan(-1);
      const corpo = fonte.slice(inicio, inicio + 800);
      expect(corpo).toContain(w.lista);
      // A exigência só vale para quem preenche como MEMBRO: o cliente anônimo
      // não vê nem pode enviar esses campos, e bloqueá-lo seria beco sem saída.
      expect(corpo).toContain("viewerIsMember");
    });
  }
});
