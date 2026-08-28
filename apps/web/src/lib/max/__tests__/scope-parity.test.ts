import { describe, it, expect } from "vitest";
import {
  projetarDeal,
  referenciaDoNegocio,
  CAMPOS_PROIBIDOS_AO_BROKER,
} from "../scope-projection";

/**
 * Vetor fixo do contrato de `POST /api/agents/scope-query` — a metade daqui.
 *
 * A outra metade é `max-agent/src/graph/__tests__/scope-parity.test.ts`, com
 * estes MESMOS literais. Regra 1 da governança do Max (`CLAUDE.md`): mudança de
 * contrato exige PR nos dois repos **e teste de vetor fixo dos dois lados**.
 *
 * **A diferença entre as duas metades, e ela é de propósito:** lá o vetor é só
 * um literal tipado — o serviço ainda não tem cliente (regra 2, receptor antes
 * do emissor). Aqui ele é comparado contra a saída REAL de `projetarDeal`. É
 * este lado que prova que o produtor produz o combinado; o outro prova que o
 * consumidor espera o combinado. Uma metade sozinha não pega divergência.
 *
 * ⚠️ **Ordem de chave importa.** O corpo HTTP preserva ordem (ao contrário de
 * `jsonb`), então a comparação é de FIO, byte a byte, e não igualdade profunda.
 */

const ATUALIZADO_EM = new Date("2026-08-19T14:02:00.000Z");

const DEAL_CRU = {
  id: "deal-1",
  title: "Apto Rua das Flores, 123 — apto 42",
  clientName: "Maria Silva",
  value: 850000,
  updatedAt: ATUALIZADO_EM,
  stage: { name: "Documentação" },
  pendencias: ["certidão de ônus"],
};

const ITEM_BROKER_SERIALIZADO =
  '{"id":"deal-1","etapa":"Documentação","pendencias":["certidão de ônus"],' +
  '"atualizadoEm":"2026-08-19T14:02:00.000Z","referencia":"Negócio #DEAL-1"}';

const ITEM_USER_SERIALIZADO =
  '{"id":"deal-1","etapa":"Documentação","pendencias":["certidão de ônus"],' +
  '"atualizadoEm":"2026-08-19T14:02:00.000Z","titulo":"Apto Rua das Flores, 123 — apto 42",' +
  '"cliente":"Maria Silva","valor":850000}';

describe("paridade do contrato de scope-query", () => {
  it("projetarDeal(broker) produz EXATAMENTE o vetor do outro repo", () => {
    expect(JSON.stringify(projetarDeal(DEAL_CRU, "broker"))).toBe(
      ITEM_BROKER_SERIALIZADO
    );
  });

  it("projetarDeal(user) produz EXATAMENTE o vetor do outro repo", () => {
    expect(JSON.stringify(projetarDeal(DEAL_CRU, "user"))).toBe(
      ITEM_USER_SERIALIZADO
    );
  });

  it("a projeção do broker afirma AUSÊNCIA dos campos proibidos", () => {
    const projetado = projetarDeal(DEAL_CRU, "broker");
    // Ausência, não presença: um teste de presença segue verde quando alguém
    // acrescenta um campo novo que vaza.
    for (const proibido of CAMPOS_PROIBIDOS_AO_BROKER) {
      expect(projetado).not.toHaveProperty(proibido);
    }
  });

  it("o endereço, o cliente e o valor não sobrevivem no fio do broker", () => {
    const fio = JSON.stringify(projetarDeal(DEAL_CRU, "broker"));
    expect(fio).not.toContain("Rua das Flores");
    expect(fio).not.toContain("Maria Silva");
    expect(fio).not.toContain("850000");
  });

  it("referencia é estável e derivada do id, não de contador", () => {
    // Estável: a mesma entrada dá a mesma saída, que é a propriedade de que a
    // conversa precisa ("aquele Negócio #X que falamos ontem").
    expect(referenciaDoNegocio("deal-1")).toBe("Negócio #DEAL-1");
    expect(referenciaDoNegocio("deal-1")).toBe(referenciaDoNegocio("deal-1"));
    // E não revela volume: deriva dos 6 últimos do cuid, então dois negócios
    // criados em sequência NÃO ganham referências vizinhas.
    expect(referenciaDoNegocio("cmt3eku95000npd8tllgdov7k")).toBe(
      "Negócio #GDOV7K"
    );
  });
});
