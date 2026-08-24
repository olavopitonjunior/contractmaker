import { describe, it, expect } from "vitest";
import { POLITICA_VAZIA, type MaxPolicyDTO } from "../policy";

/**
 * Vetor fixo do contrato de `GET /api/agents/profile` — a metade daqui.
 *
 * A outra metade é `max-agent/src/graph/__tests__/policy-parity.test.ts`, com
 * este MESMO literal. É o análogo do `hmac-parity.test.ts` para a regra 1 da
 * governança do Max: mudança de contrato exige PR nos dois repos **e teste de
 * vetor fixo dos dois lados**.
 *
 * ── Por que um contrato de FORMA precisa disto tanto quanto o do HMAC ─────
 *
 * O modo de falha do HMAC é barulhento à sua maneira: 401 em toda chamada.
 * O desta rota é pior, porque é **silencioso e assimétrico**. Se este lado
 * renomear `brokerDefault` para `brokersDefault`, o Max não quebra: ele parseia
 * um campo ausente, resolve fail-closed, e o corretor comissionado simplesmente
 * para de receber as capabilities que a imobiliária configurou. Nenhum log,
 * nenhum erro, nenhuma tela vermelha — só uma pessoa reclamando semanas depois
 * que "o Max não responde mais sobre os negócios dela".
 *
 * Por isso o literal abaixo é literal, e não construído a partir do tipo: um
 * fixture derivado do próprio código acompanharia a renomeação em silêncio, que
 * é exatamente o defeito que ele deveria pegar. Este é o mesmo erro de método
 * que já foi cometido nesta base — o oráculo do smoke não pode usar o código
 * que está sendo testado.
 */
/**
 * Duas correções que o code review exigiu, e as duas valem registro porque um
 * vetor normativo errado congela o erro nos DOIS repos:
 *
 * 1. **As chaves de `byRole` são valores reais de `OrgMembership.role`** —
 *    `owner | admin | finance | sales | viewer | custom | member`
 *    (`schema.prisma`). A primeira versão usava `"manager"`, que não existe
 *    naquele enum: um vetor assim passa nos testes e mente sobre o contrato.
 * 2. **O `allow` concede algo que o `brokerDefault` NÃO dá.** Antes ele repetia
 *    `deal.pending`, e então nenhuma asserção conseguia mostrar que o caminho
 *    de alargamento é lido — sendo que `byRecipient.allow` é a única porta de
 *    alargamento do sistema, aplicada justamente a quem não tem RBAC.
 */
export const VETOR_POLITICA = {
  byRole: {
    admin: ["deal.list", "deal.pending"],
    sales: ["deal.list", "deal.detail", "proposal.list"],
  },
  byRecipient: {
    sr_wesley: { allow: ["deal.list"], deny: ["deal.detail"] },
  },
  brokerDefault: ["deal.pending"],
} as const;

describe("paridade do contrato da política (lado ImobPro)", () => {
  /**
   * As chaves são o contrato. Nome de campo é o que o outro lado procura, e
   * procurar chave que não existe é justamente o que resolve para silêncio.
   */
  it("emite exatamente estas três chaves, nestes nomes", () => {
    const politica: MaxPolicyDTO = structuredClone(VETOR_POLITICA) as MaxPolicyDTO;

    expect(Object.keys(politica).sort()).toEqual([
      "brokerDefault",
      "byRecipient",
      "byRole",
    ]);
  });

  /** A forma interna de um override — `allow`/`deny`, e não `permitir`/`negar`. */
  it("override tem as chaves allow e deny", () => {
    expect(Object.keys(VETOR_POLITICA.byRecipient.sr_wesley).sort()).toEqual([
      "allow",
      "deny",
    ]);
  });

  /**
   * A forma vazia é a que trafega na esmagadora maioria das respostas — toda
   * org que nunca configurou nada. Ela precisa ser um OBJETO com as três
   * chaves, e não `null` nem `{}`: o outro lado lê `politica.byRole?.[role]`, e
   * as duas alternativas funcionariam por acidente hoje e quebrariam no dia em
   * que alguém trocasse o acesso opcional por acesso direto.
   */
  it("a forma VAZIA carrega as três chaves, e não é null", () => {
    expect(POLITICA_VAZIA).toEqual({
      byRole: {},
      byRecipient: {},
      brokerDefault: [],
    });
  });

  /**
   * **A serialização da forma vazia também é fixada — e ela é o payload REAL
   * de produção hoje.**
   *
   * As quatro orgs não têm linha em `MaxCapabilityPolicy`, então `getMaxPolicy`
   * devolve `POLITICA_VAZIA` em toda chamada. Ou seja: o vetor rico de 209
   * chars, que ganhou o tratamento byte a byte, descreve um caso que ainda não
   * existe em lugar nenhum — enquanto a metade do contrato que de fato trafega
   * tinha a paridade mais fraca das duas. É exatamente a assimetria que a
   * regra 1 existe para matar.
   */
  it("a forma vazia serializa exatamente assim", () => {
    expect(JSON.stringify(POLITICA_VAZIA)).toBe(
      '{"byRole":{},"byRecipient":{},"brokerDefault":[]}'
    );
  });

  /**
   * Serialização estável: é isto que atravessa a rede, byte a byte, e é isto
   * que o teste do outro repo parseia.
   */
  it("serializa exatamente assim", () => {
    expect(JSON.stringify(VETOR_POLITICA)).toBe(
      '{"byRole":{"admin":["deal.list","deal.pending"],"sales":["deal.list","deal.detail","proposal.list"]},' +
        '"byRecipient":{"sr_wesley":{"allow":["deal.list"],"deny":["deal.detail"]}},' +
        '"brokerDefault":["deal.pending"]}'
    );
  });
});
