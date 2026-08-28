import { describe, it, expect } from "vitest";
import {
  pendenciasDeRecebimento,
  mensagemDePendencia,
  temRecebimento,
  temContaCompleta,
  recebimentoFromRecipient,
} from "@/lib/forms/commissioner-receiving";

/**
 * O gate de recebimento do corretor.
 *
 * Dois casos negativos importam mais que os positivos:
 *  - quem preenche pelo link público (cliente anônimo) não pode ser bloqueado
 *    por um campo que ele nem vê — daí `enabled` já vir combinado com
 *    `viewerIsMember`;
 *  - formulário EM CIRCULAÇÃO, criado antes de os dados irem para o `dataJson`,
 *    não pode passar a acusar pendência num dado que existe no cadastro.
 */
describe("temContaCompleta / temRecebimento", () => {
  const contaCheia = {
    banco: "Itaú",
    agencia: "0001",
    conta: "12345-6",
    tipo_conta: "corrente",
  };

  it("conta completa exige banco, agência, conta E tipo", () => {
    expect(temContaCompleta(contaCheia)).toBe(true);
    expect(temContaCompleta({ ...contaCheia, agencia: "" })).toBe(false);
    expect(temContaCompleta({ ...contaCheia, tipo_conta: undefined })).toBe(false);
    // Só o nome do banco não paga ninguém.
    expect(temContaCompleta({ banco: "Itaú" })).toBe(false);
  });

  it("espaço em branco não conta como preenchido", () => {
    expect(temRecebimento({ pix_chave: "   " })).toBe(false);
    expect(temContaCompleta({ ...contaCheia, conta: "  " })).toBe(false);
  });

  it("PIX sozinho basta", () => {
    expect(temRecebimento({ pix_chave: "joao@imob.com" })).toBe(true);
  });

  it("conta completa sozinha basta — este é o ponto da mudança", () => {
    // Antes o critério era só a chave PIX, herdado de `pendingFields`, que é
    // pagabilidade da esteira de repasse. Quem digitava a conta inteira ficava
    // travado tendo informado tudo o que a exigência pede.
    expect(temRecebimento(contaCheia)).toBe(true);
  });

  it("nada preenchido, nem null/undefined, satisfaz", () => {
    expect(temRecebimento({})).toBe(false);
    expect(temRecebimento(null)).toBe(false);
    expect(temRecebimento(undefined)).toBe(false);
  });
});

describe("recebimentoFromRecipient", () => {
  it("traduz as colunas do cadastro para o shape do formulário", () => {
    expect(
      recebimentoFromRecipient({
        pixAddressKey: "chave",
        pixKeyType: "EMAIL",
        bankName: "Itaú",
        bankBranch: "0001",
        bankAccount: "12345-6",
        bankAccountType: "corrente",
        bankHolderName: "João",
        bankHolderDoc: "39012345605",
      })
    ).toEqual({
      pix_chave: "chave",
      pix_tipo_chave: "EMAIL",
      banco: "Itaú",
      agencia: "0001",
      conta: "12345-6",
      tipo_conta: "corrente",
      titular_nome: "João",
      titular_doc: "39012345605",
    });
  });

  it("coluna ausente vira null, nunca undefined", () => {
    // O shape vai para o `dataJson`; `undefined` desaparece no JSON e faria a
    // ausência do campo ser indistinguível de "nunca li o cadastro".
    expect(recebimentoFromRecipient({})).toEqual({
      pix_chave: null,
      pix_tipo_chave: null,
      banco: null,
      agencia: null,
      conta: null,
      tipo_conta: null,
      titular_nome: null,
      titular_doc: null,
    });
  });
});

describe("pendenciasDeRecebimento", () => {
  const semNada = { nome: "Ana Corretora" };
  const comPix = { nome: "Bruno", recebimento: { pix_chave: "bruno@pix.com" } };
  const comConta = {
    nome: "Carla",
    recebimento: {
      banco: "Itaú",
      agencia: "0001",
      conta: "12345-6",
      tipo_conta: "corrente",
    },
  };
  const contaParcial = {
    nome: "Diego",
    recebimento: { banco: "Itaú", agencia: "0001" },
  };

  it("desligado: nunca bloqueia", () => {
    expect(pendenciasDeRecebimento([semNada, contaParcial], false)).toEqual([]);
  });

  it("ligado: acusa quem não informou nada", () => {
    expect(pendenciasDeRecebimento([semNada], true)).toEqual([
      { index: 0, nome: "Ana Corretora", motivo: "sem_dados" },
    ]);
  });

  it("ligado: PIX passa, conta completa passa", () => {
    expect(pendenciasDeRecebimento([comPix, comConta], true)).toEqual([]);
  });

  it("ligado: conta pela metade não passa", () => {
    expect(pendenciasDeRecebimento([contaParcial], true)).toEqual([
      { index: 0, nome: "Diego", motivo: "sem_dados" },
    ]);
  });

  it("linha ainda em branco não vira pendência de recebimento", () => {
    // Nome vazio é problema do schema (nome obrigatório), não deste gate —
    // senão o corretor recebia dois erros para a mesma linha.
    expect(pendenciasDeRecebimento([{ nome: "   " }, {}], true)).toEqual([]);
  });

  it("lista vazia ou ausente não bloqueia", () => {
    expect(pendenciasDeRecebimento([], true)).toEqual([]);
    expect(pendenciasDeRecebimento(undefined, true)).toEqual([]);
  });

  it("formulário em circulação: cadastro já pagável supre o dataJson vazio", () => {
    // Até 08/2026 os dados bancários viviam SÓ no SplitRecipient e o formulário
    // guardava apenas o booleano. Sem esta regra, todo formulário aberto antes
    // da mudança passaria a acusar pendência num dado que de fato existe.
    expect(
      pendenciasDeRecebimento(
        [{ nome: "Legado", splitRecipientId: "sr9", recebimentoPendente: false }],
        true
      )
    ).toEqual([]);
  });

  it("cadastro antigo sem a flag de pendência é tratado como suprido", () => {
    // `recebimentoPendente` só passou a ser gravado em 2026-08; um formulário
    // anterior não tem a chave. Bloquear por ausência travaria negócios em
    // andamento por um dado que nunca foi coletado.
    expect(
      pendenciasDeRecebimento([{ nome: "Legado", splitRecipientId: "sr9" }], true)
    ).toEqual([]);
  });

  it("cadastro vinculado MAS pendente, e nada no formulário, é pendência", () => {
    expect(
      pendenciasDeRecebimento(
        [{ nome: "Bruno", splitRecipientId: "sr1", recebimentoPendente: true }],
        true
      )
    ).toEqual([{ index: 0, nome: "Bruno", motivo: "sem_dados" }]);
  });

  it("o dado do formulário vence a flag do cadastro", () => {
    // Acabou de digitar a chave; o booleano ainda diz "pendente" porque o
    // cadastro só sai de rascunho quando a imobiliária confirma a posse.
    expect(
      pendenciasDeRecebimento(
        [
          {
            nome: "Bruno",
            splitRecipientId: "sr1",
            recebimentoPendente: true,
            recebimento: { pix_chave: "bruno@pix.com" },
          },
        ],
        true
      )
    ).toEqual([]);
  });

  it("aponta todos os pendentes, na ordem da lista", () => {
    const r = pendenciasDeRecebimento([comPix, semNada, contaParcial], true);
    expect(r.map((x) => x.index)).toEqual([1, 2]);
  });
});

describe("mensagemDePendencia", () => {
  it("sem pendência, sem mensagem", () => {
    expect(mensagemDePendencia([])).toBe("");
  });

  it("nomeia quem falta e diz o que serve", () => {
    const msg = mensagemDePendencia([
      { index: 0, nome: "Ana", motivo: "sem_dados" },
      { index: 1, nome: "Bruno", motivo: "sem_dados" },
    ]);
    expect(msg).toContain("Ana");
    expect(msg).toContain("Bruno");
    expect(msg).toContain("PIX");
    expect(msg).toContain("conta bancária");
  });

  it("não fala de repasse automático — split não está em cena", () => {
    const msg = mensagemDePendencia([{ index: 0, nome: "Bruno", motivo: "sem_dados" }]);
    expect(msg.toLowerCase()).not.toContain("repasse");
    expect(msg.toLowerCase()).not.toContain("split");
  });
});
