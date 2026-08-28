import { describe, it, expect } from "vitest";
import {
  pendenciasDeRecebimento,
  mensagemDePendencia,
} from "@/lib/forms/commissioner-receiving";

/**
 * O gate de recebimento do corretor. O caso que mais importa é o NEGATIVO:
 * quem preenche pelo link público (cliente anônimo) não pode ser bloqueado por
 * um campo que ele nem vê — o servidor rejeita PIX/banco de não-membro, então
 * exigir dele seria um beco sem saída.
 */
describe("pendenciasDeRecebimento", () => {
  const semCadastro = { nome: "Ana Corretora" };
  const cadastroSemPix = { nome: "Bruno", splitRecipientId: "sr1", recebimentoPendente: true };
  const completo = { nome: "Carla", splitRecipientId: "sr2", recebimentoPendente: false };

  it("desligado: nunca bloqueia", () => {
    expect(pendenciasDeRecebimento([semCadastro, cadastroSemPix], false)).toEqual([]);
  });

  it("ligado: acusa quem não tem cadastro", () => {
    const r = pendenciasDeRecebimento([semCadastro], true);
    expect(r).toEqual([{ index: 0, nome: "Ana Corretora", motivo: "sem_cadastro" }]);
  });

  it("ligado: acusa cadastro salvo sem chave PIX", () => {
    const r = pendenciasDeRecebimento([cadastroSemPix], true);
    expect(r).toEqual([{ index: 0, nome: "Bruno", motivo: "sem_pix" }]);
  });

  it("ligado: cadastro completo passa", () => {
    expect(pendenciasDeRecebimento([completo], true)).toEqual([]);
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

  it("cadastro antigo sem a flag de pendência é tratado como completo", () => {
    // `recebimentoPendente` só passou a ser gravado em 2026-08; um formulário
    // anterior não tem a chave. Bloquear por ausência travaria negócios em
    // andamento por um dado que nunca foi coletado.
    expect(
      pendenciasDeRecebimento([{ nome: "Legado", splitRecipientId: "sr9" }], true)
    ).toEqual([]);
  });

  it("aponta todos os pendentes, na ordem da lista", () => {
    const r = pendenciasDeRecebimento([completo, semCadastro, cadastroSemPix], true);
    expect(r.map((x) => x.index)).toEqual([1, 2]);
  });
});

describe("mensagemDePendencia", () => {
  it("sem pendência, sem mensagem", () => {
    expect(mensagemDePendencia([])).toBe("");
  });

  it("nomeia quem falta — sem cadastro tem precedência", () => {
    const msg = mensagemDePendencia([
      { index: 0, nome: "Ana", motivo: "sem_cadastro" },
      { index: 1, nome: "Bruno", motivo: "sem_pix" },
    ]);
    expect(msg).toContain("Ana");
    expect(msg).toContain("Bruno");
    expect(msg).toContain("cadastro");
  });

  it("só PIX faltando: explica a consequência", () => {
    const msg = mensagemDePendencia([{ index: 0, nome: "Bruno", motivo: "sem_pix" }]);
    expect(msg).toContain("PIX");
    expect(msg).toContain("repasse");
  });
});
