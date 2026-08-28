import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  redactCommissionerReceiving,
  preserveCommissionerReceiving,
  stripCommissionerReceiving,
} from "@/lib/forms/redact-datajson";

/**
 * Os dados bancários do corretor passaram a viver no `dataJson` (produto: o
 * corretor reabre o formulário e encontra o que digitou). Isso os põe dentro do
 * objeto que o GET público devolve a qualquer portador do link — normalmente o
 * CLIENTE — e que alimenta a cópia lida por LLM, ClickSign e DIMOB.
 *
 * Estas duas coisas são inseparáveis, e o motivo de o arquivo existir:
 *  - REDIGIR na leitura, senão a conta do corretor vai para o cliente;
 *  - PRESERVAR na escrita, senão o autosave de quem leu redigido apaga o dado.
 *
 * Fazer uma sem a outra é pior do que não fazer nenhuma.
 */

const PIX = "corretor@pix.com";

function formCompleto() {
  return {
    vendedores: [{ nome: "Vendedor", recebimento: { banco: "Itaú", conta: "1-1" } }],
    comissao: {
      quem_paga: "vendedor",
      comissionados: [
        {
          nome: "Corretor A",
          splitRecipientId: "sr1",
          recebimento: { pix_chave: PIX, banco: "Itaú", agencia: "0001" },
        },
        { nome: "Corretor B" },
      ],
      angariadores: [
        { nome: "Angariador", splitRecipientId: "sr2", recebimento: { pix_chave: PIX } },
      ],
    },
  };
}

describe("redactCommissionerReceiving", () => {
  it("membro recebe tudo, e o MESMO objeto (sem clone à toa)", () => {
    const d = formCompleto();
    const out = redactCommissionerReceiving(d, { viewerIsMember: true });
    expect(out).toBe(d);
  });

  it("não-membro não recebe o recebimento de comissionado nem de angariador", () => {
    const out = redactCommissionerReceiving(formCompleto(), { viewerIsMember: false });
    expect(out.comissao.comissionados[0]).not.toHaveProperty("recebimento");
    expect(out.comissao.angariadores[0]).not.toHaveProperty("recebimento");
    expect(JSON.stringify(out)).not.toContain(PIX);
  });

  it("a chave some de verdade — não vira null nem undefined", () => {
    // `recebimento: null` diria "li e está vazio", que é outra afirmação.
    const out = redactCommissionerReceiving(formCompleto(), { viewerIsMember: false });
    expect("recebimento" in out.comissao.comissionados[0]).toBe(false);
  });

  it("o resto do formulário fica intacto, incluindo o recebimento das PARTES", () => {
    // O `recebimento` do vendedor é outro assunto: é conta de quem recebe pelo
    // imóvel, já vivia no dataJson antes disto e sai no resumo.
    const out = redactCommissionerReceiving(formCompleto(), { viewerIsMember: false });
    expect(out.vendedores[0].recebimento).toEqual({ banco: "Itaú", conta: "1-1" });
    expect(out.comissao.quem_paga).toBe("vendedor");
    expect(out.comissao.comissionados[1]).toEqual({ nome: "Corretor B" });
  });

  it("não muta a entrada — o mesmo dataJson é reusado no request", () => {
    const d = formCompleto();
    redactCommissionerReceiving(d, { viewerIsMember: false });
    expect(d.comissao.comissionados[0].recebimento).toEqual({
      pix_chave: PIX,
      banco: "Itaú",
      agencia: "0001",
    });
  });

  it("aguenta formulário sem comissão, sem os arrays, ou com lixo no lugar", () => {
    expect(redactCommissionerReceiving({}, { viewerIsMember: false })).toEqual({});
    expect(
      redactCommissionerReceiving({ comissao: null }, { viewerIsMember: false })
    ).toEqual({ comissao: null });
    expect(
      redactCommissionerReceiving(
        { comissao: { comissionados: "nao-e-array" } },
        { viewerIsMember: false }
      )
    ).toEqual({ comissao: { comissionados: "nao-e-array" } });
    expect(redactCommissionerReceiving(null, { viewerIsMember: false })).toBe(null);
  });
});

describe("stripCommissionerReceiving", () => {
  it("tira sem perguntar por leitor — é a cópia pro Contract.dataJson", () => {
    const out = stripCommissionerReceiving(formCompleto());
    expect(JSON.stringify(out)).not.toContain(PIX);
  });
});

describe("preserveCommissionerReceiving", () => {
  const gravado = formCompleto();

  it("restaura pelo splitRecipientId quando o autosave volta redigido", () => {
    // É o caso real: o cliente carregou o form redigido e salvou qualquer campo.
    const redigido = redactCommissionerReceiving(gravado, { viewerIsMember: false });
    const out = preserveCommissionerReceiving(redigido, gravado, {
      viewerIsMember: false,
    });
    expect(out.comissao.comissionados[0].recebimento).toEqual({
      pix_chave: PIX,
      banco: "Itaú",
      agencia: "0001",
    });
    expect(out.comissao.angariadores[0].recebimento).toEqual({ pix_chave: PIX });
  });

  it("restaura pelo ÍNDICE quando a linha ainda não tem cadastro vinculado", () => {
    const db = {
      comissao: { comissionados: [{ nome: "X", recebimento: { pix_chave: PIX } }] },
    };
    const inc = { comissao: { comissionados: [{ nome: "X" }] } };
    const out = preserveCommissionerReceiving(inc, db, { viewerIsMember: false });
    expect(out.comissao.comissionados[0].recebimento).toEqual({ pix_chave: PIX });
  });

  it("membro escreve o que mandou — inclusive apagar", () => {
    // Quem é da imobiliária VIU o dado; se ele não voltou, foi decisão dele.
    const inc = { comissao: { comissionados: [{ nome: "Corretor A" }] } };
    const out = preserveCommissionerReceiving(inc, gravado, { viewerIsMember: true });
    expect(out.comissao.comissionados[0]).not.toHaveProperty("recebimento");
  });

  it("não sobrescreve o que o autor mandou", () => {
    const inc = {
      comissao: {
        comissionados: [
          { nome: "A", splitRecipientId: "sr1", recebimento: { pix_chave: "novo@pix" } },
        ],
      },
    };
    const out = preserveCommissionerReceiving(inc, gravado, { viewerIsMember: false });
    expect(out.comissao.comissionados[0].recebimento).toEqual({ pix_chave: "novo@pix" });
  });

  it("nada gravado, nada a restaurar", () => {
    const inc = { comissao: { comissionados: [{ nome: "Novo" }] } };
    const out = preserveCommissionerReceiving(inc, {}, { viewerIsMember: false });
    expect(out).toEqual(inc);
  });

  it("redigir e preservar em sequência devolve o original", () => {
    // A propriedade que interessa: o ciclo leitura→escrita de um não-membro é
    // NEUTRO sobre os dados bancários. É o que impede a perda silenciosa.
    const redigido = redactCommissionerReceiving(gravado, { viewerIsMember: false });
    const devolta = preserveCommissionerReceiving(redigido, gravado, {
      viewerIsMember: false,
    });
    expect(devolta).toEqual(gravado);
  });
});

/**
 * Varredura das superfícies. É o guarda que importa: as duas funções acima
 * podem estar perfeitas e o vazamento acontecer porque uma rota nova esqueceu
 * de chamá-las. Ler o arquivo-fonte é grosseiro de propósito — não depende de
 * subir o Next nem de mockar Prisma, e falha no CI de quem acrescentar uma
 * superfície sem redigir.
 */
describe("as superfícies que devolvem dataJson chamam a redação", () => {
  const raiz = join(__dirname, "..", "..", "..");
  const casos: ReadonlyArray<{ arquivo: string; porque: string; fn: string }> = [
    {
      arquivo: "app/api/forms/[token]/route.ts",
      porque: "GET devolve o dataJson inteiro a qualquer portador do link",
      fn: "redactCommissionerReceiving",
    },
    {
      arquivo: "app/api/locacao/forms/[token]/route.ts",
      porque: "idem, esteira de locação",
      fn: "redactCommissionerReceiving",
    },
    {
      arquivo: "app/f/[token]/[[...slug]]/page.tsx",
      porque: "initialData desce pro browser de quem abrir o link",
      fn: "redactCommissionerReceiving",
    },
    {
      arquivo: "lib/services/contract-generation.ts",
      porque: "fan-out pro Contract.dataJson, que o LLM/ClickSign/DIMOB leem",
      fn: "stripCommissionerReceiving",
    },
  ];

  for (const caso of casos) {
    it(`${caso.arquivo} — ${caso.porque}`, () => {
      const src = readFileSync(join(raiz, caso.arquivo), "utf-8");
      expect(src).toContain(caso.fn);
    });
  }

  it("os dois PATCH públicos preservam na escrita", () => {
    // Sem isto a redação vira perda de dado: o autosave do cliente devolve o
    // array sem `recebimento` e o merge apagaria o que estava gravado.
    for (const arquivo of [
      "app/api/forms/[token]/route.ts",
      "app/api/locacao/forms/[token]/route.ts",
    ]) {
      const src = readFileSync(join(raiz, arquivo), "utf-8");
      expect(src, arquivo).toContain("preserveCommissionerReceiving");
    }
  });
});
