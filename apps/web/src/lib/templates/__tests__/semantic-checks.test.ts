import { describe, it, expect } from "vitest";
import {
  countBySeverity,
  persistableSemanticReport,
  readSemanticReport,
  runSemanticChecks,
  type OrgFacts,
  type SemanticFinding,
} from "../semantic-checks";

/**
 * Os casos abaixo saíram do rebuild da RE/MAX Trio (03/09/2026): a cláusula de
 * rateio do 1º aluguel — item a) da imobiliária, b) e c) dos corretores — é
 * onde as quatro classes de erro apareceram juntas.
 */
const ORG: OrgFacts = {
  legalName: "Trio Negócios Imobiliários Ltda",
  cnpj: "12.345.678/0001-90",
  creci: "79.434-J",
  pixAddressKey: "financeiro@trio.exemplo.br",
  bankBranch: "1234-5",
  bankAccount: "98765-4",
};

function run(
  docText: string,
  opts: { org?: OrgFacts | null; sourceText?: string | null; modalidade?: string } = {}
) {
  return runSemanticChecks({
    docText,
    modalidade: opts.modalidade ?? "locacao",
    org: opts.org === undefined ? null : opts.org,
    sourceText: opts.sourceText ?? null,
  });
}

const byCategory = (findings: SemanticFinding[], category: string) =>
  findings.filter((f) => f.category === category);

describe("wrong-entity — chave da parte errada", () => {
  const itemDaImobiliaria = (token: string) =>
    `a) R$ 2.500,00 (dois mil e quinhentos reais), a ser pago diretamente à imobiliária intermediadora ${token}, como honorários pela intermediação imobiliária;`;

  it("aponta a chave do corretor num item que fala da imobiliária, com o rekey pronto", () => {
    const { findings } = run(itemDaImobiliaria("{{corretagem_qualificacao}}"));
    const hits = byCategory(findings, "wrong-entity");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("error");
    expect(hits[0].token).toBe("corretagem_qualificacao");
    expect(hits[0].suggestedFix).toEqual({
      op: "rekey",
      phrase: itemDaImobiliaria("{{corretagem_qualificacao}}"),
      fromToken: "corretagem_qualificacao",
      toToken: "imobiliaria_qualificacao",
    });
  });

  it("não aponta nada quando a chave já é a da imobiliária", () => {
    const { findings } = run(itemDaImobiliaria("{{imobiliaria_qualificacao}}"));
    expect(byCategory(findings, "wrong-entity")).toHaveLength(0);
  });

  it("aponta a chave da imobiliária num item que fala do corretor", () => {
    const doc =
      "b) R$ 1.200,00, a ser pago diretamente ao(à) corretor(a) intermediador(a) {{imobiliaria_dados_pagamento}};";
    const hits = byCategory(run(doc).findings, "wrong-entity");
    expect(hits).toHaveLength(1);
    expect(hits[0].suggestedFix).toMatchObject({
      op: "rekey",
      toToken: "corretagem_dados_pagamento",
    });
  });

  it("tolera aposto entre o substantivo e o qualificador", () => {
    const doc =
      "a) valor pago à imobiliária, doravante denominada intermediadora, {{corretagem_qualificacao}};";
    const hits = byCategory(run(doc).findings, "wrong-entity");
    expect(hits).toHaveLength(1);
    expect(hits[0].suggestedFix).toMatchObject({ toToken: "imobiliaria_qualificacao" });
  });

  it("a pista não atravessa o fim da frase", () => {
    // "intermediadora" pertence à oração seguinte: não é pista deste trecho.
    const doc =
      "A imobiliária cadastrou o imóvel. A corretora intermediadora recebe {{corretagem_qualificacao}}.";
    expect(byCategory(run(doc).findings, "wrong-entity")).toHaveLength(0);
  });

  it("cala quando a frase tem as DUAS pistas — não é decidível por palavra", () => {
    const doc =
      "a) valor pago à imobiliária intermediadora, representada por seu corretor intermediador {{corretagem_qualificacao}};";
    expect(byCategory(run(doc).findings, "wrong-entity")).toHaveLength(0);
  });

  it("não propõe rekey para chave que não existe na modalidade", () => {
    // Em venda não há `imobiliaria_*`: sem destino no catálogo, não há conserto.
    const doc = "a) pago à imobiliária intermediadora {{corretagem_qualificacao}};";
    expect(byCategory(run(doc, { modalidade: "a_vista" }).findings, "wrong-entity")).toHaveLength(0);
  });
});

describe("org-literal — dado da própria imobiliária escrito no modelo", () => {
  it("pega o CNPJ da org mesmo com formatação diferente da cadastrada", () => {
    const doc = "A ADMINISTRADORA, inscrita no CNPJ sob o nº 12345678000190, com sede nesta cidade.";
    const hits = byCategory(run(doc, { org: ORG }).findings, "org-literal");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("warning");
    expect(hits[0].message).toContain("imobiliaria_qualificacao");
  });

  it("não casa um dado curto DENTRO de um número maior (agência dentro do CNPJ)", () => {
    // `bankBranch: "1234-5"` é prefixo de `12345678000190`: comparar cadeias de
    // dígitos sem fronteira dava dois achados no mesmo parágrafo.
    const doc = "A ADMINISTRADORA, inscrita no CNPJ sob o nº 12345678000190, com sede nesta cidade.";
    const hits = byCategory(run(doc, { org: ORG }).findings, "org-literal");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("CNPJ");
  });

  it("pega a agência quando ela aparece como número inteiro", () => {
    const doc = "Depósito na agência 1234-5, conta 98765-4 do Banco do Brasil.";
    const hits = byCategory(run(doc, { org: ORG }).findings, "org-literal");
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.message.includes("imobiliaria_dados_pagamento"))).toBe(true);
  });

  it("ignora CNPJ de terceiro", () => {
    const doc = "A construtora, inscrita no CNPJ sob o nº 99.888.777/0001-66, declara.";
    expect(byCategory(run(doc, { org: ORG }).findings, "org-literal")).toHaveLength(0);
  });

  it("pega a chave PIX da org", () => {
    const doc = "Pagamento via PIX para financeiro@trio.exemplo.br, em até 5 dias.";
    const hits = byCategory(run(doc, { org: ORG }).findings, "org-literal");
    expect(hits.some((h) => h.message.includes("chave PIX"))).toBe(true);
  });

  it("dado da org que NÃO identifica ninguém é ignorado (00000 dentro de R$ 00.000,00)", () => {
    // Medido na bateria contra os 16 contratos reais (04/09): a org do bench
    // tinha `creci: "00000-J"` e `bankAccount: "00000-0"`, e os cinco zeros
    // casavam dentro de "R$ 00.000,00" — três acusações de "traz o CRECI da
    // imobiliária" em parágrafos sem CRECI nenhum.
    //
    // Não é artefato de laboratório: cadastro novo com campo preenchido como
    // `00000-0` ou `11111` é comum, e é justamente o tenant recém-criado que
    // mais precisa que a primeira revisão seja confiável.
    const orgDegenerada: OrgFacts = {
      ...ORG,
      creci: "00000-J",
      bankAccount: "00000-0",
      bankBranch: "11111",
    };
    const doc =
      "3.1. O valor do aluguel mensal é de R$ 00.000,00 (reais), corrigido a cada 12 meses.";
    expect(byCategory(run(doc, { org: orgDegenerada }).findings, "org-literal")).toHaveLength(0);
  });

  it("o CNPJ real da MESMA org continua sendo acusado", () => {
    // Controle: sem ele, o caso acima passaria com a regra inteira desligada.
    const orgDegenerada: OrgFacts = { ...ORG, creci: "00000-J", bankAccount: "00000-0" };
    const doc = "A ADMINISTRADORA, inscrita no CNPJ sob o nº 12.345.678/0001-90, declara.";
    expect(byCategory(run(doc, { org: orgDegenerada }).findings, "org-literal")).toHaveLength(1);
  });

  it("não roda sem cadastro da org e diz que não rodou", () => {
    const doc = "CNPJ 12.345.678/0001-90.";
    const report = run(doc, { org: null });
    expect(report.orgFactsAvailable).toBe(false);
    expect(byCategory(report.findings, "org-literal")).toHaveLength(0);
  });
});

describe("leftover-identifier — dado do titular ao lado da chave", () => {
  it("pega o CRECI literal e propõe remover a frase COM o separador", () => {
    const doc = "b) pago a {{corretagem_qualificacao}}, CRECI 12345-F, conforme ajustado.";
    const hits = byCategory(run(doc).findings, "leftover-identifier");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("warning");
    expect(hits[0].suggestedFix).toEqual({
      op: "remove-leftover",
      phrase: ", CRECI 12345-F",
    });
  });

  it("trata CPF ao lado da chave como erro", () => {
    const doc = "b) pago a {{corretagem_qualificacao}}, CPF 529.982.247-25, na conta indicada.";
    const hits = byCategory(run(doc).findings, "leftover-identifier");
    expect(hits[0].severity).toBe("error");
    expect(hits[0].suggestedFix).toMatchObject({ op: "remove-leftover" });
  });

  it("a frase proposta para remoção nunca carrega uma chave (removê-la apagaria o campo)", () => {
    const doc = "b) {{corretagem_qualificacao}} CRECI 12345-F {{corretagem_dados_pagamento}}.";
    const hits = byCategory(run(doc).findings, "leftover-identifier");
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      if (hit.suggestedFix?.op !== "remove-leftover") continue;
      expect(hit.suggestedFix.phrase).not.toContain("{{");
      expect(doc).toContain(hit.suggestedFix.phrase);
    }
  });

  it("ignora parágrafo sem chave de dado", () => {
    const doc = "O corretor CRECI 12345-F assina este instrumento.";
    expect(byCategory(run(doc).findings, "leftover-identifier")).toHaveLength(0);
  });

  it("mascara o dado no excerto do relatório", () => {
    const doc = "b) pago a {{corretagem_qualificacao}}, CPF 529.982.247-25.";
    const hits = byCategory(run(doc).findings, "leftover-identifier");
    expect(hits[0].excerpt).not.toContain("529.982.247-25");
  });

  it("redige CRECI e chave PIX, que nenhum detector de PII reconhece", () => {
    // O excerto é PERSISTIDO e RENDERIZADO: sem esta redação o relatório
    // exibiria justamente o número que ele existe para denunciar.
    const creci = byCategory(
      run("b) pago a {{corretagem_qualificacao}}, CRECI 12345-F, conforme ajustado.").findings,
      "leftover-identifier"
    );
    expect(creci[0].excerpt).not.toContain("12345-F");
    expect(creci[0].excerpt).toContain("[CRECI]");

    const pix = byCategory(
      run("b) {{corretagem_dados_pagamento}} chave PIX 7a1f9c22-bd41-4a55-9e02-11ce3d77aa10.")
        .findings,
      "leftover-identifier"
    );
    expect(pix[0].excerpt).not.toContain("7a1f9c22-bd41-4a55-9e02-11ce3d77aa10");
  });
});

describe("collapsed-paragraph — a cláusula virou uma chave só", () => {
  const anterior =
    "4.1.1. O pagamento correspondente ao primeiro aluguel será rateado da seguinte forma:";
  const posterior =
    "4.1.2. Os valores acima serão retidos pela ADMINISTRADORA no primeiro repasse ao LOCADOR.";
  const itemOriginal =
    "a) R$ 2.500,00 (dois mil e quinhentos reais), a ser pago diretamente à imobiliária intermediadora Trio, como honorários pela intermediação;";

  it("com o contrato-fonte, aponta o colapso e propõe restaurar o parágrafo", () => {
    const doc = [anterior, "{{imobiliaria_qualificacao}}", posterior].join("\n");
    const source = [anterior, itemOriginal, posterior].join("\n");
    const hits = byCategory(run(doc, { sourceText: source }).findings, "collapsed-paragraph");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("error");
    expect(hits[0].suggestedFix).toEqual({
      op: "restore-paragraph",
      current: "{{imobiliaria_qualificacao}}",
      source: itemOriginal,
    });
  });

  it("não acusa bloco de cláusula, que substitui a cláusula inteira por desenho", () => {
    // Medido em staging (03/09/2026): a regra valia para todo bloco composto e
    // acusava `{{clausula_garantia}}`. `assinaturas`, `bloco_administradora` e
    // `parcelas_pagamento` têm o mesmo papel — para eles, engolir a cláusula é
    // o comportamento correto.
    for (const token of [
      "clausula_garantia",
      "assinaturas",
      "bloco_administradora",
      "parcelas_pagamento",
    ]) {
      const doc = [anterior, `{{${token}}}`, posterior].join("\n");
      const source = [anterior, itemOriginal, posterior].join("\n");
      expect(
        byCategory(run(doc, { sourceText: source }).findings, "collapsed-paragraph")
      ).toHaveLength(0);
    }
    // A chave de DADO no mesmo lugar continua sendo acusada.
    const comDado = [anterior, "{{imobiliaria_qualificacao}}", posterior].join("\n");
    expect(
      byCategory(run(comDado, { sourceText: [anterior, itemOriginal, posterior].join("\n") }).findings, "collapsed-paragraph")
    ).toHaveLength(1);
  });

  it("cala quando o parágrafo do fonte era mesmo só uma qualificação", () => {
    const abre = "Pelo presente instrumento, as partes abaixo qualificadas ajustam o seguinte:";
    const fecha = "Resolvem celebrar o presente contrato de locação, que se regerá pelas cláusulas.";
    const doc = [abre, "{{locadores_qualificacao}}", fecha].join("\n");
    const source = [
      abre,
      "Helena Castro Vilaboim, brasileira, viúva, engenheira, residente nesta capital",
      fecha,
    ].join("\n");
    expect(byCategory(run(doc, { sourceText: source }).findings, "collapsed-paragraph")).toHaveLength(0);
  });

  it("qualificação LONGA continua calando — o tamanho não faz de um parágrafo uma cláusula", () => {
    // Medido na staging em 03/09/2026, e o defeito era grave: a regra tinha o
    // comprimento como segundo gatilho (`|| source.length > 400`). A
    // qualificação completa de dois locadores passa disso sem ter nada de
    // cláusula, e a regra promovia o trabalho BEM FEITO a "erro" — propondo
    // restaurar nome, RG e CPF das pessoas dentro do modelo.
    const abre = "Pelo presente instrumento particular, as partes abaixo qualificadas:";
    const fecha = "Resolvem celebrar o presente contrato de locação residencial.";
    const qualificacaoLonga =
      "HELENA CASTRO VILABOIM, brasileira, viúva, engenheira civil, portadora da cédula de " +
      "identidade RG nº 12.345.678-9 SSP/SP, inscrita no CPF sob o nº 111.444.777-35, " +
      "residente e domiciliada na Rua das Acácias, nº 1.200, apartamento 74, bairro Jardim " +
      "Paulistano, São Paulo/SP, CEP 01455-000, e ROBERTO ALMEIDA VILABOIM, brasileiro, " +
      "solteiro, arquiteto, portador da cédula de identidade RG nº 98.765.432-1 SSP/SP, " +
      "residente e domiciliado no mesmo endereço acima descrito";
    expect(qualificacaoLonga.length).toBeGreaterThan(400);
    const doc = [abre, "{{locadores_qualificacao}}", fecha].join("\n");
    const source = [abre, qualificacaoLonga, fecha].join("\n");
    expect(
      byCategory(run(doc, { sourceText: source }).findings, "collapsed-paragraph")
    ).toHaveLength(0);
  });

  it("colapso REAL cujo fonte tem PII não oferece restaurar — pede ajuste manual", () => {
    // Segunda rede, independente da primeira. Uma heurística pode errar; o
    // conserto que ela propõe não pode desfazer o gate de PII devolvendo o dado
    // de um terceiro ao modelo.
    const itemComCpf =
      "a) R$ 2.500,00 (dois mil e quinhentos reais), a ser pago a Marcos Antônio Ferreira, " +
      "inscrito no CPF sob o nº 111.444.777-35, como honorários pela intermediação;";
    const doc = [anterior, "{{imobiliaria_qualificacao}}", posterior].join("\n");
    const source = [anterior, itemComCpf, posterior].join("\n");
    const hits = byCategory(run(doc, { sourceText: source }).findings, "collapsed-paragraph");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("error");
    expect(hits[0].suggestedFix).toEqual({ op: "manual" });
    expect(hits[0].message).toMatch(/dado pessoal/i);
    // E o excerto que vai para a tela continua mascarado.
    expect(hits[0].excerpt).not.toContain("111.444.777-35");
  });

  it("colapso de cláusula SEM valor (posse, vistoria) é acusado — não só as de R$", () => {
    // Este caso já foi o oposto, e por pouco tempo: quando o gatilho de
    // comprimento saiu, cláusula sem termo de valor passou a escapar, e o teste
    // registrava a dívida em vez de escondê-la. As fixtures reais de locação
    // têm cláusulas inteiras de prazo, posse e vistoria que nenhum termo de
    // valor alcançava — o buraco era real, não hipotético —, então
    // `CLAUSE_LANGUAGE` ganhou os termos de OBJETO.
    //
    // O que tornou seguro alargar foi a rede de PII: qualificação de pessoa
    // física carrega CPF, então mesmo que um termo volte a casar com uma delas,
    // o conserto vira `manual` em vez de um botão que devolve o dado ao modelo.
    const abre = "5.1. Da posse do imóvel:";
    const fecha = "5.2. As benfeitorias necessárias serão indenizadas na forma da lei.";
    const clausulaSemValor =
      "A posse será transmitida ao LOCATÁRIO na data da assinatura, mediante termo de " +
      "vistoria assinado pelas partes, permanecendo o imóvel sob responsabilidade do " +
      "LOCADOR até aquele momento.";
    const doc = [abre, "{{locatarios_qualificacao}}", fecha].join("\n");
    const source = [abre, clausulaSemValor, fecha].join("\n");
    const hits = byCategory(run(doc, { sourceText: source }).findings, "collapsed-paragraph");
    expect(hits).toHaveLength(1);
    // Fonte sem dado pessoal: aqui restaurar É o conserto certo.
    expect(hits[0].suggestedFix?.op).toBe("restore-paragraph");
  });

  it("os termos de objeto NÃO casam com qualificação — nem a de pessoa jurídica", () => {
    // A rede de PII cobre pessoa física (CPF é obrigatório na qualificação).
    // Pessoa JURÍDICA pura NÃO é coberta por ela — nome, endereço e CNPJ não
    // bloqueiam a ativação —, então, para esse padrão, este caso é a única
    // proteção contra o falso positivo voltar. Por isso ele existe separado.
    const abre = "Pelo presente instrumento particular, as partes:";
    const fecha = "Têm entre si justo e contratado o presente contrato de locação.";
    const qualificacaoPJ =
      "IMOBILIÁRIA HORIZONTE LTDA., pessoa jurídica de direito privado, inscrita no CNPJ " +
      "sob o nº 12.345.678/0001-90, com sede na Avenida Brasil, nº 2.400, conjunto 32, " +
      "bairro Centro, Campinas/SP, CEP 13010-000, neste ato representada na forma de seu " +
      "contrato social, doravante denominada ADMINISTRADORA";
    const doc = [abre, "{{imobiliaria_qualificacao}}", fecha].join("\n");
    const source = [abre, qualificacaoPJ, fecha].join("\n");
    expect(
      byCategory(run(doc, { sourceText: source }).findings, "collapsed-paragraph")
    ).toHaveLength(0);
  });

  it("sem fonte, só avisa quando o parágrafo anterior abre uma lista ou fala de comissão", () => {
    const doc = [anterior, "{{imobiliaria_qualificacao}}", posterior].join("\n");
    const hits = byCategory(run(doc).findings, "collapsed-paragraph");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("warning");
    expect(hits[0].suggestedFix).toEqual({ op: "manual" });
  });

  it("sem fonte e sem contexto de lista, não inventa achado", () => {
    const doc = ["Das partes:", "{{locadores_qualificacao}}"].join("\n");
    const hits = byCategory(run(doc).findings, "collapsed-paragraph");
    // "Das partes:" abre lista — o aviso é legítimo, mas some se o anterior é prosa comum.
    expect(hits).toHaveLength(1);
    const outro = ["O imóvel é residencial e está desocupado.", "{{locadores_qualificacao}}"].join("\n");
    expect(byCategory(run(outro).findings, "collapsed-paragraph")).toHaveLength(0);
  });

  it("âncora ambígua no fonte não propõe restauração", () => {
    const repetido = "As partes ajustam o pagamento na forma abaixo descrita neste contrato.";
    const doc = [repetido, "{{imobiliaria_qualificacao}}", posterior].join("\n");
    const source = [repetido, itemOriginal, posterior, repetido].join("\n");
    const hits = byCategory(run(doc, { sourceText: source }).findings, "collapsed-paragraph");
    expect(hits.every((h) => h.suggestedFix?.op !== "restore-paragraph")).toBe(true);
  });
});

describe("split-list-tokenized — a lista de rateio foi chaveada item a item", () => {
  // COPIADO do Doc de produção da RE/MAX Trio (04/09/2026), com os valores
  // preservados: é o defeito em 16 de 16 modelos, e a razão desta regra existir.
  const cabecalho =
    "4.1.1. O pagamento correspondente ao primeiro aluguel do imóvel objeto deste contrato será liquidado e fracionado diretamente aos intermediadores da locação, da seguinte forma:";
  const itemA =
    "a) R$0000 (Três mil, quinhentos e sessenta e nove reais e setenta e um centavos), a ser pago diretamente à imobiliária intermediadora {{imobiliaria_qualificacao}}, como honorários pela intermediação imobiliária na presente locação, por meio {{imobiliaria_dados_pagamento}};";
  const itemB =
    "b) R$ 1.315,15 (hum mil, trezentos e quinze reais e quinze centavos), a ser pago diretamente à corretora intermediadora {{corretagem_dados_pagamento}}";
  const itemC =
    "c) R$ 1.315,15 (hum mil, trezentos e quinze reais e quinze centavos), a ser pago diretamente ao corretor intermediador {{corretagem_qualificacao}}.";
  const depois = "4.1.2. Os valores acima serão retidos pela ADMINISTRADORA no primeiro repasse.";

  it("acusa a lista da Trio e propõe trocar os TRÊS itens pela chave composta", () => {
    const doc = [cabecalho, itemA, itemB, itemC, depois].join("\n");
    const hits = byCategory(run(doc).findings, "split-list-tokenized");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("error");
    expect(hits[0].suggestedFix).toEqual({
      op: "replace-block",
      paragraphs: [itemA, itemB, itemC],
      token: "rateio_primeiro_aluguel",
    });
  });

  it("o CABEÇALHO da cláusula fica de fora do bloco a substituir", () => {
    // Engolir o "4.1.1." apagaria a abertura da cláusula e deixaria a lista
    // órfã — e o 4.1.2 passaria a citar um item que não existe mais.
    const doc = [cabecalho, itemA, itemB, itemC, depois].join("\n");
    const fix = byCategory(run(doc).findings, "split-list-tokenized")[0].suggestedFix;
    expect(fix?.op).toBe("replace-block");
    if (fix?.op !== "replace-block") throw new Error("fix errado");
    expect(fix.paragraphs).not.toContain(cabecalho);
    expect(fix.paragraphs).not.toContain(depois);
  });

  it("um item sozinho NÃO é lista — a chave composta não resolveria nada", () => {
    const doc = [cabecalho, itemA, depois].join("\n");
    expect(byCategory(run(doc).findings, "split-list-tokenized")).toHaveLength(0);
  });

  it("lista JÁ corrigida não é acusada de novo", () => {
    const doc = [cabecalho, "{{rateio_primeiro_aluguel}}", depois].join("\n");
    expect(byCategory(run(doc).findings, "split-list-tokenized")).toHaveLength(0);
  });

  it("não acusa em modalidade sem a chave composta no catálogo", () => {
    // Em venda `rateio_primeiro_aluguel` não existe: apontar um defeito sem
    // conserto possível é pior que calar.
    const doc = [cabecalho, itemA, itemB, itemC].join("\n");
    expect(
      byCategory(run(doc, { modalidade: "a_vista" }).findings, "split-list-tokenized")
    ).toHaveLength(0);
  });

  it("lista sem chave de beneficiário (valores literais) não é este defeito", () => {
    const doc = [
      cabecalho,
      "a) R$ 1.000,00, a ser pago à imobiliária intermediadora Trio Negócios;",
      "b) R$ 1.000,00, a ser pago ao corretor intermediador João;",
    ].join("\n");
    expect(byCategory(run(doc).findings, "split-list-tokenized")).toHaveLength(0);
  });

  it("duas listas separadas viram dois achados, cada um com o seu bloco", () => {
    const doc = [cabecalho, itemA, itemB, depois, cabecalho, itemA, itemC].join("\n");
    const hits = byCategory(run(doc).findings, "split-list-tokenized");
    expect(hits).toHaveLength(2);
    expect(hits[0].id).not.toBe(hits[1].id);
  });

  it("o excerto vai mascarado para a tela", () => {
    const comCpf =
      "b) R$ 1.315,15, a ser pago ao corretor intermediador {{corretagem_qualificacao}}, CPF 111.444.777-35";
    const doc = [cabecalho, itemA, comCpf].join("\n");
    const hits = byCategory(run(doc).findings, "split-list-tokenized");
    expect(hits).toHaveLength(1);
    expect(JSON.stringify(hits[0].excerpt)).not.toContain("111.444.777-35");
  });
});

describe("dangling-reference — citação de item que não existe", () => {
  const cita = "4.1.2. Os valores do item 4.1.1 serão retidos no primeiro repasse.";

  it("erro quando o fonte definia o item e o documento não define mais", () => {
    const source = "4.1.1. O pagamento do primeiro aluguel será rateado assim:\n" + cita;
    const hits = byCategory(run(cita, { sourceText: source }).findings, "dangling-reference");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("error");
  });

  it("info quando nem o fonte definia — a citação já vinha quebrada", () => {
    const hits = byCategory(run(cita, { sourceText: "Contrato sem esse item." }).findings, "dangling-reference");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("info");
  });

  it("cala quando o item existe no documento", () => {
    const doc = "4.1.1. O pagamento será rateado assim:\n" + cita;
    expect(byCategory(run(doc).findings, "dangling-reference")).toHaveLength(0);
  });
});

describe("literal-signature-block — bloco de assinaturas fixo no modelo", () => {
  // 16 de 16 modelos da Trio (04/09/2026): a IA propôs `assinaturas`, o passe
  // recusou, e o bloco ficou literal — em dois deles com os nomes das partes
  // do contrato-fonte. Nenhuma checagem via isso.
  const corpo = [
    "CLÁUSULA DÉCIMA - DO FORO",
    "Fica eleito o foro da comarca de São Paulo.",
    "São Paulo, 10 de março de 2025.",
  ];
  const blocoAnonimo = [
    "____________________________________________",
    "Nome",
    "PARTE LOCATÁRIA",
    "____________________________________________",
    "xxxxxxxxxxx",
    "PARTE LOCADORA",
    "___________________________________________",
    "Nome",
    "CPF",
    "Testemunha",
  ];

  it("bloco sem nome de pessoa: warning com replace-block sobre a sequência exata", () => {
    const r = run([...corpo, ...blocoAnonimo].join("\n"));
    const f = byCategory(r.findings, "literal-signature-block");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("warning");
    expect(f[0]!.paragraphIndex).toBe(corpo.length);
    expect(f[0]!.token).toBe("assinaturas");
    expect(f[0]!.suggestedFix).toEqual({
      op: "replace-block",
      paragraphs: blocoAnonimo,
      token: "assinaturas",
    });
  });

  it("nome de pessoa do contrato-fonte no bloco: error", () => {
    const bloco = [
      "____________________________________________",
      "JOSÉ MAURÍCIO ZENHA DE TOLEDO",
      "PARTE LOCATÁRIA",
      "____________________________________________",
      "CINDY TAVARES COSTA PARTE LOCATÁRIA",
      "____________________________________________",
      "NOME LOCADOR",
      "PARTE LOCADORA",
    ];
    const r = run([...corpo, ...bloco].join("\n"));
    const f = byCategory(r.findings, "literal-signature-block");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("error");
    expect(f[0]!.message).toMatch(/2 partes/);
    expect(f[0]!.suggestedFix).toMatchObject({ op: "replace-block", paragraphs: bloco });
  });

  it("para no primeiro parágrafo que não é material de assinatura", () => {
    const depois = ["ANEXO I - VISTORIA", "O imóvel foi entregue com 3 (três) chaves, pintura nova e piso em bom estado, R$ 0,00 de pendência."];
    const r = run([...corpo, ...blocoAnonimo, ...depois].join("\n"));
    const f = byCategory(r.findings, "literal-signature-block");
    expect(f).toHaveLength(1);
    expect((f[0]!.suggestedFix as { paragraphs: string[] }).paragraphs).toEqual(blocoAnonimo);
  });

  it("ADVERSARIAL: título em caixa alta e frase de cláusula depois das linhas NÃO entram no bloco", () => {
    // A revisão do #580: "DA VIGÊNCIA DO CONTRATO" e "Fica eleito o foro da
    // comarca de São Paulo" tinham forma de nome para a regra anterior. Um
    // `error` com "trocar o bloco pela chave" apagaria cláusula.
    const cauda = [
      "DA VIGÊNCIA DO CONTRATO",
      "DAS DISPOSIÇÕES GERAIS",
      "Fica eleito o foro da comarca de São Paulo",
    ];
    const r = run([...corpo, ...blocoAnonimo, ...cauda].join("\n"));
    const f = byCategory(r.findings, "literal-signature-block");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("warning");
    expect((f[0]!.suggestedFix as { paragraphs: string[] }).paragraphs).toEqual(blocoAnonimo);
  });

  it("ADVERSARIAL: linhas de sublinhado sem rótulo de signatário (ficha de vistoria) não são bloco", () => {
    const vistoria = [
      "VISTORIA DE ENTRADA",
      "Estado da pintura",
      "________________",
      "Estado do piso",
      "________________",
      "Observações",
      "________________",
    ];
    const r = run([...corpo, ...vistoria].join("\n"));
    expect(byCategory(r.findings, "literal-signature-block")).toEqual([]);
  });

  it("ADVERSARIAL: seção com sublinhados ANTES do bloco real não desloca o achado", () => {
    const ficha = ["Endereço para correspondência", "________________", "Telefone", "________________"];
    const r = run([...corpo, ...ficha, "CLÁUSULA FINAL", ...blocoAnonimo].join("\n"));
    const f = byCategory(r.findings, "literal-signature-block");
    expect(f).toHaveLength(1);
    expect(f[0]!.paragraphIndex).toBe(corpo.length + ficha.length + 1);
    expect((f[0]!.suggestedFix as { paragraphs: string[] }).paragraphs).toEqual(blocoAnonimo);
  });

  it("razão social com 'Ltda.' abaixo da linha conta como nome; cidade solta não vira cláusula", () => {
    const bloco = [
      "____________________________________________",
      "Atrio Negócios Imobiliários Ltda.",
      "ADMINISTRADORA",
      "____________________________________________",
      "PARTE LOCADORA",
    ];
    const r = run([...corpo, ...bloco].join("\n"));
    const f = byCategory(r.findings, "literal-signature-block");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("error");
  });

  it("linha que é só uma chave (qualificação no lugar do nome) é material do bloco, não corte", () => {
    // Produção, 04/09: dois modelos de fiador tinham {{locadores_qualificacao}}
    // na célula do locador; a regra parava ali, propunha bloco parcial, e a
    // estrutura recusava (a tabela inteira não casava).
    const bloco = [
      "____________________________________________",
      "JAQUELINE AGUILAR BORGES",
      "PARTE LOCATÁRIA",
      "____________________________________________",
      "{{locadores_qualificacao}}",
      "PARTE LOCADORA",
      "___________________________________________",
      "Nome",
      "CPF",
      "Testemunha",
    ];
    const r = run([...corpo, ...bloco, "Rodapé da imobiliária"].join("\n"));
    const f = byCategory(r.findings, "literal-signature-block");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("error");
    expect((f[0]!.suggestedFix as { paragraphs: string[] }).paragraphs).toEqual(bloco);
  });

  it("cala quando {{assinaturas}} já está no documento", () => {
    const r = run([...corpo, "{{assinaturas}}"].join("\n"));
    expect(byCategory(r.findings, "literal-signature-block")).toEqual([]);
  });

  it("cala com uma linha de assinatura só, e fora do catálogo de locação", () => {
    const uma = [...corpo, "____________________________________________", "PARTE LOCADORA"];
    expect(byCategory(run(uma.join("\n")).findings, "literal-signature-block")).toEqual([]);
    const venda = run([...corpo, ...blocoAnonimo].join("\n"), { modalidade: "a_vista" });
    expect(byCategory(venda.findings, "literal-signature-block")).toEqual([]);
  });
});

describe("contrato do relatório", () => {
  it("não lança com documento vazio nem com fonte ausente", () => {
    expect(() => run("")).not.toThrow();
    const report = run("");
    expect(report.findings).toEqual([]);
    expect(report.sourceAvailable).toBe(false);
  });

  it("a forma persistida perde as frases cruas do conserto", () => {
    const doc = "a) pago à imobiliária intermediadora {{corretagem_qualificacao}};";
    const report = run(doc);
    const persisted = persistableSemanticReport(report);
    expect(report.findings[0].suggestedFix).toMatchObject({ phrase: expect.any(String) });
    expect(persisted.findings[0].suggestedFix).toEqual({ op: "rekey" });
    // Nenhum campo de frase crua do conserto sobrevive à persistência.
    for (const key of ["phrase", "current", "source"]) {
      expect(JSON.stringify(persisted.findings.map((f) => f.suggestedFix))).not.toContain(key);
    }
  });

  it("ids são estáveis e únicos dentro do mesmo parágrafo", () => {
    const doc = "b) {{corretagem_qualificacao}}, CRECI 12345-F, CPF 529.982.247-25.";
    const first = run(doc).findings.map((f) => f.id);
    const second = run(doc).findings.map((f) => f.id);
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(first.length);
  });

  it("lê relatório gravado e tolera formato ausente ou malformado", () => {
    const report = run("a) pago à imobiliária intermediadora {{corretagem_qualificacao}};");
    const saved = JSON.parse(JSON.stringify({ semantic: persistableSemanticReport(report) }));
    expect(readSemanticReport(saved)?.findings).toHaveLength(1);
    expect(readSemanticReport({})).toBeNull();
    expect(readSemanticReport({ semantic: "nada" })).toBeNull();
    expect(readSemanticReport(null)).toBeNull();
  });

  it("conta por severidade", () => {
    expect(countBySeverity([{ severity: "error" }, { severity: "info" }] as SemanticFinding[])).toEqual({
      error: 1,
      warning: 0,
      info: 1,
    });
  });
});
