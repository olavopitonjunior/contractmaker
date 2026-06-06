import { describe, it, expect } from "vitest";
import {
  isProtestoNadaConsta,
  isPedidoDuplicado,
  decideObterOutcome,
  isEndpointNotEnabled,
  isPortalUnavailableMessage,
  isReceitaCertidaoNaoEmitida,
  isDataDivergente,
  mapInfosimplesCodeToCategory,
} from "../error-codes";

describe("isDataDivergente + 608 divergência → inconsistent_input (não missing)", () => {
  it("casa 'divergente da constante na base' (Receita CPF 608 real)", () => {
    expect(
      isDataDivergente(
        "Data de nascimento informada 20/09/1972 está divergente da constante na base de dados da Secretaria da Receita Federal do Brasil."
      )
    ).toBe(true);
  });
  it("casa 'diferente da cadastrada' (PGFN 608 real)", () => {
    expect(
      isDataDivergente("Data de nascimento informada é diferente da cadastrada.")
    ).toBe(true);
  });
  it("casa 'não coincidem' (TRF5 608 real — cruza com a Receita)", () => {
    expect(
      isDataDivergente(
        "Data de nascimento preenchida e data de nascimento consultada na receita federal não coincidem."
      )
    ).toBe(true);
    expect(
      mapInfosimplesCodeToCategory(
        608,
        "Data de nascimento preenchida e ... na receita federal não coincidem."
      )
    ).toBe("inconsistent_input");
  });
  it("NÃO casa 'parâmetros obrigatórios não foram enviados' (606 = realmente falta)", () => {
    expect(
      isDataDivergente("Parâmetros obrigatórios não foram enviados.")
    ).toBe(false);
  });
  it("608 com mensagem de divergência → inconsistent_input (data_invalid), NÃO missing_input", () => {
    expect(
      mapInfosimplesCodeToCategory(
        608,
        "Os parâmetros foram recusados. Data de nascimento informada é diferente da cadastrada."
      )
    ).toBe("inconsistent_input");
  });
  it("608 sem divergência segue missing_input (CODE_MAP)", () => {
    expect(mapInfosimplesCodeToCategory(608, "Os parâmetros foram recusados.")).toBe(
      "missing_input"
    );
  });
});

describe("isEndpointNotEnabled (603 endpoint-específico ≠ crédito da conta)", () => {
  it("detecta 'consulta não habilitada para a sua conta'", () => {
    expect(
      isEndpointNotEnabled(
        "Consulta 'ieptb/protestos' não habilitada para a sua conta. Para habilitar, preencha o formulário em https://api.infosimples.com/habilitar/ieptb%2Fprotestos"
      )
    ).toBe(true);
  });
  it("detecta 'não tem autorização de acesso ao serviço'", () => {
    expect(
      isEndpointNotEnabled(
        "O token informado não tem autorização de acesso ao serviço."
      )
    ).toBe(true);
  });
  it("NÃO casa com 'conta está sem saldo' (crédito real → deve tripar breaker)", () => {
    expect(
      isEndpointNotEnabled("A conta está sem saldo. Adicione saldo para usar a API.")
    ).toBe(false);
  });
  it("vazio/null → false", () => {
    expect(isEndpointNotEnabled(null)).toBe(false);
    expect(isEndpointNotEnabled("")).toBe(false);
  });
});

describe("isProtestoNadaConsta", () => {
  it("casa 'não constam protestos' em endpoint de protesto", () => {
    expect(
      isProtestoNadaConsta(
        "cenprot-sp/protestos",
        "Não constam protestos nos cartórios participantes, cuja abrangência em SP é de 100%"
      )
    ).toBe(true);
  });

  it("casa 'nada consta' em ieptb", () => {
    expect(isProtestoNadaConsta("ieptb/protestos", "Nada consta")).toBe(true);
  });

  it("NÃO casa em endpoint que não é de protesto (PGFN)", () => {
    expect(
      isProtestoNadaConsta("receita-federal/pgfn", "Não constam protestos")
    ).toBe(false);
  });

  it("NÃO casa fetch failed / portal indisponível", () => {
    expect(
      isProtestoNadaConsta(
        "cenprot-sp/protestos",
        "O site ou aplicativo de origem parece estar indisponível."
      )
    ).toBe(false);
  });

  it("mensagem vazia → false", () => {
    expect(isProtestoNadaConsta("cenprot-sp/protestos", null)).toBe(false);
  });
});

describe("isPedidoDuplicado", () => {
  it("casa 'Já existe(m) pedido(s)...'", () => {
    expect(
      isPedidoDuplicado(
        "Já existe(m) pedido(s) com os dados informados para o(s) tipo(s) de certidão: Cível. Aguarde o processamento do pedido atual."
      )
    ).toBe(true);
  });

  it("casa 'aguarde o processamento do pedido'", () => {
    expect(isPedidoDuplicado("Aguarde o processamento do pedido atual.")).toBe(
      true
    );
  });

  it("NÃO casa erro de 2FA GOV.BR (também é code 620)", () => {
    expect(
      isPedidoDuplicado(
        "A verificação em duas etapas está ativada na sua conta GOV.BR. Você pode desativar..."
      )
    ).toBe(false);
  });

  it("NÃO casa 'email inválido' (608)", () => {
    expect(isPedidoDuplicado("Favor preencher com um email válido")).toBe(false);
  });

  it("mensagem vazia → false", () => {
    expect(isPedidoDuplicado(null)).toBe(false);
  });
});

describe("isPortalUnavailableMessage (609 'tentativas excedidas' é portal, não dado)", () => {
  it("casa 'Tentativas de consultar o site ... excedidas' (TRF3/TRT15 hoje)", () => {
    expect(
      isPortalUnavailableMessage(
        "Tentativas de consultar o site ou aplicativo de origem excedidas."
      )
    ).toBe(true);
  });
  it("casa 'site ou aplicativo de origem ... indisponível / sobrecarregado'", () => {
    expect(
      isPortalUnavailableMessage(
        "O site ou aplicativo de origem está sobrecarregado. Tente novamente em alguns instantes."
      )
    ).toBe(true);
    expect(
      isPortalUnavailableMessage(
        "O site ou aplicativo de origem parece estar indisponível."
      )
    ).toBe(true);
  });
  it("casa 'API foi pausada / instabilidade na fonte' (IEPTB 615)", () => {
    expect(
      isPortalUnavailableMessage(
        "A API foi pausada temporariamente. O motivo mais provável é instabilidade na fonte de origem."
      )
    ).toBe(true);
  });
  it("NÃO casa erro de dado genuíno (608/606)", () => {
    expect(
      isPortalUnavailableMessage(
        "Dados (nome, nome da mãe ou data de nascimento) não conferem com o CPF informado."
      )
    ).toBe(false);
    expect(
      isPortalUnavailableMessage("Parâmetros obrigatórios: data_nascimento")
    ).toBe(false);
  });
  it("vazio/null → false", () => {
    expect(isPortalUnavailableMessage(null)).toBe(false);
    expect(isPortalUnavailableMessage("")).toBe(false);
  });
});

describe("mapInfosimplesCodeToCategory — 609 com mensagem de portal", () => {
  it("609 'tentativas excedidas' → portal_unavailable (retry), NÃO inconsistent_input", () => {
    expect(
      mapInfosimplesCodeToCategory(
        609,
        "Tentativas de consultar o site ou aplicativo de origem excedidas."
      )
    ).toBe("portal_unavailable");
  });
  it("609 com mensagem de dado real → inconsistent_input (mantém)", () => {
    expect(
      mapInfosimplesCodeToCategory(609, "O campo informado foi rejeitado pelo portal")
    ).toBe("inconsistent_input");
  });
});

describe("isReceitaCertidaoNaoEmitida (PGFN 611 = RFB não emite online)", () => {
  it("casa a frase exata da RFB (job real de hoje)", () => {
    expect(
      isReceitaCertidaoNaoEmitida(
        "As informações disponíveis na Receita Federal sobre o contribuinte 302.326.708-11 são insuficientes para emitir a certidão pela Internet."
      )
    ).toBe(true);
  });
  it("NÃO casa 'nada consta' nem erro de dado nosso", () => {
    expect(isReceitaCertidaoNaoEmitida("Nada consta")).toBe(false);
    expect(
      isReceitaCertidaoNaoEmitida("Dados não conferem com o CPF informado")
    ).toBe(false);
  });
  it("vazio/null → false", () => {
    expect(isReceitaCertidaoNaoEmitida(null)).toBe(false);
  });
});

describe("decideObterOutcome (limite de retry do 2º passo)", () => {
  const within = { ageMs: 1000, attempts: 1, maxRetries: 3, maxWaitMs: 12 * 60 * 60_000 };

  it("account_issue (603) → falha imediata, independente de tentativas/idade", () => {
    expect(decideObterOutcome("account_issue", within)).toEqual({ action: "fail", reason: "account" });
    expect(
      decideObterOutcome("account_issue", { ageMs: 0, attempts: 1, maxRetries: 3, maxWaitMs: 9e9 })
    ).toEqual({ action: "fail", reason: "account" });
  });

  it("integration_error (602) → falha imediata", () => {
    expect(decideObterOutcome("integration_error", within)).toEqual({ action: "fail", reason: "integration" });
  });

  it("portal_unavailable com tentativas < max → retry", () => {
    expect(decideObterOutcome("portal_unavailable", { ...within, attempts: 1, maxRetries: 3 })).toEqual({ action: "retry" });
    expect(decideObterOutcome("portal_unavailable", { ...within, attempts: 2, maxRetries: 3 })).toEqual({ action: "retry" });
  });

  it("portal_unavailable na 3ª tentativa → falha (esgotou)", () => {
    expect(decideObterOutcome("portal_unavailable", { ...within, attempts: 3, maxRetries: 3 })).toEqual({ action: "fail", reason: "transient_exhausted" });
  });

  it("rate_limited também é transitório (bounded)", () => {
    expect(decideObterOutcome("rate_limited", { ...within, attempts: 3, maxRetries: 3 })).toEqual({ action: "fail", reason: "transient_exhausted" });
  });

  it("ainda processando dentro do prazo → wait (não conta tentativa)", () => {
    expect(decideObterOutcome("genuine_no_data", within)).toEqual({ action: "wait" });
    expect(decideObterOutcome("missing_input", within)).toEqual({ action: "wait" });
  });

  it("ainda processando além do prazo → falha (deadline)", () => {
    expect(
      decideObterOutcome("genuine_no_data", { ageMs: 13 * 60 * 60_000, attempts: 1, maxRetries: 3, maxWaitMs: 12 * 60 * 60_000 })
    ).toEqual({ action: "fail", reason: "deadline" });
  });
});
