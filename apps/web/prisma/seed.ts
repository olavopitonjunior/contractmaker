import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // 1. Create admin user
  const passwordHash = await bcrypt.hash("admin123", 10);
  const user = await prisma.user.upsert({
    where: { email: "admin@contractmaker.com" },
    update: {},
    create: {
      email: "admin@contractmaker.com",
      name: "Admin",
      passwordHash,
      role: "admin",
    },
  });
  console.log("User created:", user.email);

  // 2. Create organization
  const org = await prisma.organization.upsert({
    where: { slug: "default" },
    update: {},
    create: {
      name: "Contractmaker",
      slug: "default",
      members: {
        create: {
          userId: user.id,
          role: "owner",
        },
      },
    },
  });
  console.log("Organization created:", org.name);

  // 3. Create pipeline with stages
  const existingPipeline = await prisma.pipeline.findFirst({
    where: { orgId: org.id },
  });

  if (!existingPipeline) {
    const pipeline = await prisma.pipeline.create({
      data: {
        orgId: org.id,
        name: "Pipeline Principal",
        stages: {
          create: [
            { name: "Formulário", color: "#6366f1", position: 0 },
            { name: "Confecção de Contrato", color: "#f59e0b", position: 1 },
            { name: "Assinatura", color: "#3b82f6", position: 2 },
            { name: "Concluído", color: "#22c55e", position: 3 },
          ],
        },
      },
    });
    console.log("Pipeline created:", pipeline.name);
  }

  // 4. Create contract templates (v2: A Vista + Financiamento)
  function loadTemplate(filename: string): string {
    const templatePath = path.resolve(__dirname, "../../../templates", filename);
    try {
      return fs.readFileSync(templatePath, "utf-8");
    } catch {
      console.warn("Template HBS file not found at", templatePath);
      return "<!-- Template placeholder -->";
    }
  }

  // Deprecate legacy template if it exists
  await prisma.contractTemplate.updateMany({
    where: { orgId: org.id, schemaType: "compra_venda_v1" },
    data: { status: "deprecated", isDefault: false },
  });

  // Create A Vista template
  const existingAVista = await prisma.contractTemplate.findFirst({
    where: { orgId: org.id, modalidade: "a_vista", schemaType: "compra_venda_v2" },
  });
  if (!existingAVista) {
    await prisma.contractTemplate.create({
      data: {
        orgId: org.id,
        name: "CCV - Pagamento À Vista",
        description: "Instrumento particular de compromisso de venda e compra - modalidade pagamento à vista",
        version: "2.0.0",
        schemaType: "compra_venda_v2",
        handlebarsSource: loadTemplate("ccv_a_vista_v2.hbs"),
        isDefault: true,
        status: "active",
        modalidade: "a_vista",
      },
    });
    console.log("Template CCV À Vista v2 created");
  }

  // Create Financiamento template
  const existingFinanciamento = await prisma.contractTemplate.findFirst({
    where: { orgId: org.id, modalidade: "financiamento", schemaType: "compra_venda_v2" },
  });
  if (!existingFinanciamento) {
    await prisma.contractTemplate.create({
      data: {
        orgId: org.id,
        name: "CCV - Financiamento Imobiliário",
        description: "Instrumento particular de compromisso de venda e compra - modalidade financiamento imobiliário",
        version: "2.0.0",
        schemaType: "compra_venda_v2",
        handlebarsSource: loadTemplate("ccv_financiamento_v2.hbs"),
        isDefault: true,
        status: "active",
        modalidade: "financiamento",
      },
    });
    console.log("Template CCV Financiamento v2 created");
  }

  // 5. Seed clause library
  const existingClauses = await prisma.clause.count({
    where: { orgId: org.id },
  });

  if (existingClauses === 0) {
    const clauses = [
      {
        category: "partes",
        subcategory: "vendedor",
        title: "Qualificacao do Vendedor PF",
        content: `{{#each vendedores}}
{{#if (eq this.tipo_pessoa "fisica")}}
<p><strong>Promitente Vendedor(a):</strong></p>
<p>
Nome: {{this.nome}}<br>
Nacionalidade: {{this.nacionalidade}}<br>
Estado Civil: {{this.estado_civil}}<br>
Profissao: {{this.profissao}}<br>
RG: n {{this.rg}}<br>
CPF: n {{cpf this.cpf}}<br>
E-mail: {{this.email}}<br>
Endereco: {{this.endereco}}, n {{this.numero}}{{#if this.complemento}}, Complemento: {{this.complemento}}{{/if}}, Cidade: {{this.cidade}}-{{this.uf}}, CEP {{cep this.cep}}
</p>
{{/if}}
{{/each}}`,
        tags: ["vendedor", "pessoa-fisica", "qualificacao"],
        source: "imported",
      },
      {
        category: "partes",
        subcategory: "comprador",
        title: "Qualificacao do Comprador PF",
        content: `{{#each compradores}}
{{#if (eq this.tipo_pessoa "fisica")}}
<p><strong>Promissario(a) Comprador(a):</strong></p>
<p>
Nome: {{this.nome}}<br>
Nacionalidade: {{this.nacionalidade}}<br>
Estado Civil: {{this.estado_civil}}<br>
Profissao: {{this.profissao}}<br>
RG: n {{this.rg}}<br>
CPF: n {{cpf this.cpf}}<br>
E-mail: {{this.email}}<br>
Endereco: {{this.endereco}}, n {{this.numero}}{{#if this.complemento}}, Complemento: {{this.complemento}}{{/if}}, Cidade: {{this.cidade}}-{{this.uf}}, CEP {{cep this.cep}}
</p>
{{/if}}
{{/each}}`,
        tags: ["comprador", "pessoa-fisica", "qualificacao"],
        source: "imported",
      },
      {
        category: "objeto",
        subcategory: "imovel",
        title: "Descricao do Imovel",
        content: `{{#each imoveis}}
<p>
Endereco: {{this.rua}}, n {{this.numero}}{{#if this.complemento}}, Complemento: {{this.complemento}}{{/if}}, Bairro: {{this.bairro}}, Cidade: {{this.cidade}} - {{this.uf}}, CEP {{cep this.cep}}<br>
Matricula: n {{this.matricula}} do {{this.cartorio}}<br>
Contribuinte: n {{this.inscricao_iptu}} junto a Prefeitura local<br>
Descricao: {{this.descricao}}
</p>
{{/each}}`,
        tags: ["imovel", "descricao", "matricula", "endereco"],
        source: "imported",
      },
      {
        category: "objeto",
        subcategory: "debitos",
        title: "Declaracao de Debitos",
        content: `{{#if tem_debitos}}
<p><strong>2.1.</strong> Declara ainda, tal PARTE VENDEDORA, que inexistem discussoes/pleitos quanto a legitimidade dos direitos que detem sobre tal bem, porem tendo sido identificadas pendencias de natureza propter rem (IPTU e/ou eventual condominio), quais sejam:</p>
<ul>
{{#if debitos.iptu.selecionado}}
<li>IPTU no valor de {{moeda debitos.iptu.valor}}.</li>
{{/if}}
{{#if debitos.condominio.selecionado}}
<li>Condominio no valor de {{moeda debitos.condominio.valor}}.</li>
{{/if}}
{{#if (existe debitos.outros)}}
<li>{{debitos.outros}}</li>
{{/if}}
</ul>
{{/if}}`,
        tags: ["debitos", "iptu", "condominio", "propter-rem"],
        source: "imported",
      },
      {
        category: "compromisso",
        subcategory: "vicios",
        title: "Vicios Redibitórios - Renuncia",
        content: `<p><strong>3.1.</strong> A PARTE COMPRADORA vistoriou o imovel e o aceita no estado em que se encontra, renunciando expressamente aos direitos de reclamacoes, sejam indenizatorias ou redibitórias (anulacao da transacao), por vicios redibitórios, ainda que estruturais e/ou ocultos.</p>`,
        tags: ["vicios", "renuncia", "redibitorio"],
        source: "imported",
      },
      {
        category: "preco",
        subcategory: "pagamento",
        title: "Tabela de Pagamento",
        content: `<p>O preco ajustado para a presente transacao e de {{moeda pagamento.valor_total}}, que sera pago da seguinte forma:</p>
<table>
<tr><th>Forma</th><th>Valor</th></tr>
{{#if (gt pagamento.sinal_arras 0)}}
<tr><td>Sinal/Arras</td><td>{{moeda pagamento.sinal_arras}}</td></tr>
{{/if}}
{{#if (gt pagamento.recursos_proprios 0)}}
<tr><td>Recursos Proprios</td><td>{{moeda pagamento.recursos_proprios}}</td></tr>
{{/if}}
{{#if (gt pagamento.fgts 0)}}
<tr><td>FGTS</td><td>{{moeda pagamento.fgts}}</td></tr>
{{/if}}
{{#if (gt pagamento.alienacao_fiduciaria 0)}}
<tr><td>Alienacao Fiduciaria</td><td>{{moeda pagamento.alienacao_fiduciaria}}</td></tr>
{{/if}}
{{#each pagamento.parcelas}}
<tr><td>Parcela {{@index}} ({{this.tipo_texto}})</td><td>{{moeda this.valor}}</td></tr>
{{/each}}
<tr><th>TOTAL</th><th>{{moeda pagamento.valor_total}}</th></tr>
</table>`,
        tags: ["preco", "pagamento", "parcelas", "tabela"],
        source: "imported",
      },
      {
        category: "posse",
        subcategory: "entrega",
        title: "Entrega de Posse",
        content: `<p>A posse do imovel sera entregue a PARTE COMPRADORA, livre de pessoas e objetos nao incluidos no preco, no ato da {{entrega_posse.momento_texto}}.</p>
<p><strong>5.1.</strong> A partir de tal data, a PARTE COMPRADORA sera responsavel por todos os tributos e encargos relativos ao imovel.</p>`,
        tags: ["posse", "entrega", "responsabilidade"],
        source: "imported",
      },
      {
        category: "titulo",
        subcategory: "escritura",
        title: "Titulo Definitivo - Escritura",
        content: `<p>Estando as partes adimplentes com as obrigacoes deste contrato, lavrar-se-a escritura publica de venda e compra diretamente a PARTE COMPRADORA ou a quem esta indicar, ficando os emolumentos notariais, registrais, ITBI e demais custos as exclusivas expensas da PARTE COMPRADORA.</p>
<p><strong>6.1.</strong> Estabelece-se um prazo de {{titulo_definitivo.prazo_dias}} dias para a lavratura do instrumento definitivo.</p>`,
        tags: ["titulo", "escritura", "prazo", "itbi"],
        source: "imported",
      },
      {
        category: "comissao",
        subcategory: "intermediacao",
        title: "Comissao de Intermediacao",
        content: `<p>Juntamente ao pagamento do Sinal, a {{comissao.quem_paga_texto}} arcara com honorarios pela assessoria e intermediacao no valor total de {{moeda comissao.valor}}, quantia esta que tem como participe e credora:</p>
<p>{{moeda comissao.valor}} a {{comissao.imobiliaria_nome}}, CNPJ n {{cnpj comissao.imobiliaria_cnpj}}, atuando como Imobiliaria.</p>`,
        tags: ["comissao", "intermediacao", "imobiliaria", "honorarios"],
        source: "imported",
      },
      {
        category: "penalidades",
        subcategory: "irretratabilidade",
        title: "Irretratabilidade e Cominacoes",
        content: `<p>O presente compromisso vincula herdeiros e sucessores e e celebrado sob caracteres de irrevogabilidade e irretratabilidade, pelo que renunciam a faculdade de arrependimento prevista no art. 420 do Codigo Civil.</p>`,
        tags: ["irretratabilidade", "irrevogabilidade", "multa"],
        source: "imported",
      },
      {
        category: "penalidades",
        subcategory: "multas",
        title: "Multas por Atraso",
        content: `<p><strong>8.2.</strong> Caso ocorra o atraso do pagamento do preco ou quaisquer de suas eventuais parcelas, ensejara:</p>
<ul>
<li>Multa penal de {{config.multa_penal_moratoria}}% sobre o valor atrasado</li>
<li>Juros moratorios mensais de {{config.juros_mensais_atraso}}%</li>
<li>Atualizacao monetaria conforme {{config.atualizacao_monetaria}}</li>
</ul>
<p>Transcorridos {{config.prazo_atraso_rescisao}} dias uteis de atraso, ficara a discricionariedade da PARTE VENDEDORA a rescisao.</p>`,
        tags: ["multa", "atraso", "juros", "rescisao"],
        source: "imported",
      },
      {
        category: "foro",
        subcategory: "arbitragem",
        title: "Foro - Arbitragem",
        content: `<p>Para dirimir eventuais disputas e controversias envolvendo o objeto do presente, as partes expressamente elegem, por convencao de arbitragem e exclusao de qualquer outro foro, nos termos do artigo 5 e do 1 do artigo 4 da Lei n 9.307/1996, os seguintes foros privados:</p>
<ul>
<li>TASP (Centro de Mediacao e Arbitragem de Sao Paulo)</li>
<li>ACORDIA</li>
<li>Arbitranet</li>
</ul>`,
        tags: ["foro", "arbitragem", "jurisdicao"],
        source: "imported",
      },
      {
        category: "foro",
        subcategory: "justica-publica",
        title: "Foro - Justica Publica",
        content: `<p>Para dirimir eventuais disputas e controversias envolvendo o objeto do presente, as partes expressamente elegem o Foro da situacao do imovel, com exclusao de qualquer outro.</p>`,
        tags: ["foro", "justica", "comarca"],
        source: "imported",
      },
      {
        category: "foro",
        subcategory: "lgpd",
        title: "LGPD e Privacidade",
        content: `<p>As partes manifestam ciencia do respeito, por parte dos intermediadores, a Lei n 13.709/2018 - Lei Geral de Protecao de Dados (LGPD) - e, respeitando a Politica de Privacidade de Dados, autorizam a coleta, uso, armazenamento, tratamento e protecao de seus dados pessoais.</p>`,
        tags: ["lgpd", "privacidade", "dados-pessoais"],
        source: "imported",
      },
    ];

    for (const clause of clauses) {
      await prisma.clause.create({
        data: {
          orgId: org.id,
          ...clause,
          status: "approved",
        },
      });
    }
    console.log(`${clauses.length} legacy clauses seeded`);
  }

  // 5b. Seed standardized clause bank v2 (23 variable clauses)
  const existingV2Clauses = await prisma.clause.count({
    where: { orgId: org.id, source: "standard_v2" },
  });

  if (existingV2Clauses === 0) {
    const clauseBankV2 = [
      // ========== G1 - SINAL, ARRAS E INÍCIO DE PAGAMENTO ==========
      {
        category: "preco",
        subcategory: "sinal",
        title: "Arras Confirmatórias",
        groupCode: "G1",
        isVariable: true,
        content: `<p>O valor de {{moeda pagamento.sinal_arras}} ({{extenso pagamento.sinal_arras}}), pago nesta data a título de sinal e princípio de pagamento, constitui arras confirmatórias nos termos do art. 417 do Código Civil. Referido valor integra o preço total do negócio e não será devolvido ao(s) PROMISSÓRIO(S) COMPRADOR(ES) em caso de desistência injustificada de sua parte.</p>`,
        agentNotes: "Base legal: CC arts. 417 a 420. Usar quando há sinal pago no ato da assinatura com prazo fatal de 1 dia útil para compensação.",
        tags: ["sinal", "arras", "confirmatorias", "art-417"],
        source: "standard_v2",
      },
      {
        category: "preco",
        subcategory: "sinal",
        title: "Rescisão Automática por Não Pagamento do Sinal",
        groupCode: "G1",
        isVariable: true,
        content: `<p>Não ocorrendo o crédito da parcela de sinal em até 1 (um) dia útil a contar da assinatura do presente instrumento, por qualquer motivo, o presente instrumento restará rescindido de pleno direito e sem qualquer outra formalidade, com o retorno das partes ao status quo ante e o imóvel ao patrimônio e à livre disposição dos PROMITENTES VENDEDORES.</p>`,
        agentNotes: "Mecanismo mais preciso que a mera perda das arras. A rescisão é automática, sem necessidade de notificação.",
        tags: ["sinal", "rescisao-automatica", "status-quo-ante"],
        source: "standard_v2",
      },
      {
        category: "preco",
        subcategory: "sinal",
        title: "Pagamento Proporcional em Contas Indicadas",
        groupCode: "G1",
        isVariable: true,
        content: `<p>Os pagamentos serão realizados na proporção estabelecida no preâmbulo deste instrumento, mediante depósitos bancários via TED ou Pix, por expressa, formal e irrevogável indicação dos PROMITENTES VENDEDORES, nas contas bancárias por eles indicadas, valendo os comprovantes de transferência como recibos de pagamento. Fica desde já ratificado eventual instrumento particular de confissão de dívida celebrado entre os PROMITENTES VENDEDORES para fins de equalização de cotas.</p>`,
        agentNotes: "Aplicável quando há pluralidade de vendedores (herdeiros, condôminos). Exige indicação prévia das contas e das proporções. Ratificação de confissão de dívida entre co-titulares deve constar do preâmbulo.",
        tags: ["pagamento", "proporcional", "pluralidade-vendedores", "contas"],
        source: "standard_v2",
      },
      // ========== G2 - IMISSÃO NA POSSE ==========
      {
        category: "posse",
        subcategory: "imissao",
        title: "Posse Após Pagamento Integral",
        groupCode: "G2",
        isVariable: true,
        content: `<p>A imissão na posse do IMÓVEL dar-se-á em até {{config.prazo_posse_dias}} dias corridos contados da confirmação bancária do pagamento integral do preço previsto na Cláusula Segunda, devendo o IMÓVEL ser entregue livre e desembaraçado de pessoas, coisas e débitos.</p>`,
        agentNotes: "O prazo costuma variar entre 15 e 60 dias. Multa por atraso: R$ 500/dia + 20% após 30 dias. Usar em contratos à vista.",
        tags: ["posse", "pagamento-integral", "a-vista"],
        source: "standard_v2",
      },
      {
        category: "posse",
        subcategory: "imissao",
        title: "Posse Após Registro do Financiamento",
        groupCode: "G2",
        isVariable: true,
        content: `<p>A posse do IMÓVEL será transmitida ao(s) PROMISSÁRIO(S) COMPRADOR(ES) em até 1 (um) dia útil contado do registro do Instrumento Definitivo (Contrato de Financiamento) junto ao Cartório de Registro de Imóveis competente, devendo o IMÓVEL estar livre de pessoas e coisas.</p>`,
        agentNotes: "Padrão Zimmermann para financiamento. Mais preciso que 'concomitantemente à liberação dos recursos'. Usar em contratos com financiamento.",
        tags: ["posse", "financiamento", "registro", "cartorio"],
        source: "standard_v2",
      },
      {
        category: "posse",
        subcategory: "imissao",
        title: "Posse Precária por Liberalidade",
        groupCode: "G2",
        isVariable: true,
        content: `<p>Por mera liberalidade dos PROMITENTES VENDEDORES e sem qualquer novação ou renúncia de direitos contratuais, fica facultada a imissão precária na posse do IMÓVEL ao(s) PROMISSÁRIO(S) COMPRADOR(ES) a partir de {{config.data_posse_precaria}}, ficando este(s) responsável(is) pelo pagamento de todas as despesas incidentes sobre o IMÓVEL a partir de referida data. A posse definitiva apenas se dará com o cumprimento integral das condições previstas neste instrumento.</p>`,
        agentNotes: "Incluir Termo de Vistoria assinado antes da entrega das chaves. A posse precária não transfere propriedade nem autoriza obras sem anuência expressa.",
        tags: ["posse", "precaria", "liberalidade", "antecipada"],
        source: "standard_v2",
      },
      {
        category: "posse",
        subcategory: "imissao",
        title: "Entrega Ad Corpus com Itens Listados",
        groupCode: "G2",
        isVariable: true,
        content: `<p>Os PROMITENTES VENDEDORES declaram que o IMÓVEL será entregue no estado geral que se encontra, mantendo todos os itens necessários para habitabilidade e em especial os elencados a seguir: {{config.itens_entrega}}. A venda é feita em caráter "ad corpus".</p>`,
        agentNotes: "Listar itens precisamente: armários embutidos, vasos, pias, metálicos, lustres, móveis planejados etc. Divergências posteriores são vedadas pela cláusula ad corpus.",
        tags: ["posse", "ad-corpus", "itens", "entrega"],
        source: "standard_v2",
      },
      // ========== G3 - RESCISÃO E CONDIÇÃO RESOLUTIVA ==========
      {
        category: "penalidades",
        subcategory: "rescisao",
        title: "Rescisão Simétrica 5%",
        groupCode: "G3",
        isVariable: true,
        content: `<p>Caso a rescisão seja motivada pelo(s) PROMISSÁRIO(S) COMPRADOR(ES), os PROMITENTES VENDEDORES deverão reter 5% (cinco por cento) do valor do negócio, devendo restituir a diferença no prazo de 5 (cinco) dias corridos a contar da comunicação formal. Caso a rescisão seja motivada pelos PROMITENTES VENDEDORES, caberá a estes efetuarem a devolução dos valores já recebidos, acrescidos de 5% (cinco por cento) do valor do negócio, no prazo de 5 (cinco) dias corridos. Não havendo cumprimento dos prazos de devolução, incidirá multa diária de R$ 500,00 (quinhentos reais) até o efetivo cumprimento.</p>`,
        agentNotes: "Modelo Zimmermann. Simétrico: 5% para ambos os lados. Diferente da perda das arras (que é assimétrica). Multa diária de R$ 500 pelo atraso na devolução.",
        tags: ["rescisao", "simetrica", "5-porcento", "multa-diaria"],
        source: "standard_v2",
      },
      {
        category: "penalidades",
        subcategory: "rescisao",
        title: "Condição Resolutiva por Não Obtenção de Financiamento",
        groupCode: "G3",
        isVariable: true,
        content: `<p>Na eventualidade do(s) PROMISSÁRIO(S) COMPRADOR(ES) não lograr(em) a obtenção do financiamento bancário indispensável à continuidade da transação imobiliária, ficará o presente instrumento rescindido de pleno direito. O(s) PROMISSÁRIO(S) COMPRADOR(ES) será(ão) ressarcido(s) integralmente do montante pago até então, sem a imposição de penalidades ou encargos moratórios aos envolvidos, retornando as partes ao status quo ante.</p>`,
        agentNotes: "Restituição integral, sem penalidades. Distinguir desta cláusula a hipótese de não obtenção por culpa do comprador, que deve remeter à cláusula de rescisão por inadimplência. OBRIGATÓRIA em contratos com financiamento.",
        tags: ["rescisao", "financiamento", "condicao-resolutiva", "restituicao-integral"],
        source: "standard_v2",
      },
      {
        category: "penalidades",
        subcategory: "rescisao",
        title: "Purgação da Mora - 15 Dias Adicionais",
        groupCode: "G3",
        isVariable: true,
        content: `<p>Fica convencionado que, depois de decorridos os prazos estabelecidos nas cláusulas de inadimplência e documentação, é garantido prazo adicional de 15 (quinze) dias corridos para purgação da mora, através dos meios de comunicação previstos nas disposições finais, após os quais o presente contrato será rescindido de pleno direito (condição resolutiva expressa), não obstante seu caráter de irrevogabilidade e irretratabilidade.</p>`,
        agentNotes: "Inserir sempre entre a cláusula de inadimplência e a de rescisão. O prazo de purgação da mora corre após o prazo de inadimplência (15 dias), totalizando até 30 dias antes da rescisão automática.",
        tags: ["mora", "purgacao", "15-dias", "resolutiva"],
        source: "standard_v2",
      },
      {
        category: "penalidades",
        subcategory: "rescisao",
        title: "Suspensão de Pagamentos por Atraso Documental",
        groupCode: "G3",
        isVariable: true,
        content: `<p>Na hipótese de haver atraso pelos PROMITENTES VENDEDORES na entrega completa dos documentos elencados neste instrumento, ficam suspensos todos os pagamentos a serem feitos pelo(s) PROMISSÁRIO(S) COMPRADOR(ES) por até 15 (quinze) dias corridos, após os quais ficará configurada a hipótese de rescisão contratual nos termos da cláusula de rescisão.</p>`,
        agentNotes: "Mecanismo de proteção do comprador. O prazo de suspensão de pagamentos é paralelo ao prazo de purgação da mora do vendedor.",
        tags: ["suspensao", "pagamentos", "documentacao", "protecao-comprador"],
        source: "standard_v2",
      },
      // ========== G4 - FINANCIAMENTO E REGISTRO ==========
      {
        category: "titulo",
        subcategory: "financiamento",
        title: "Prazo de 45 Dias Úteis para Financiamento",
        groupCode: "G4",
        isVariable: true,
        content: `<p>O(s) PROMISSÁRIO(S) COMPRADOR(ES) tem(êm) o prazo máximo de 45 (quarenta e cinco) dias úteis a contar da entrega de toda a documentação prevista na cláusula de documentação para apresentação do Instrumento Particular de Venda e Compra com Força de Escritura Pública (Contrato de Financiamento), sendo que os PROMITENTES VENDEDORES comprometem-se a atender de imediato a convocação do agente financeiro. O(s) PROMISSÁRIO(S) COMPRADOR(ES) ficam responsáveis por enviar o comprovante de prenotação (protocolo) junto ao Cartório de Registro de Imóveis em até 1 (um) dia útil contado da assinatura do Contrato de Financiamento.</p>`,
        agentNotes: "Prazo de 45 dias úteis do modelo Zimmermann, contado da entrega da documentação completa (não da assinatura do CCV). OBRIGATÓRIO em contratos com financiamento.",
        tags: ["financiamento", "prazo", "45-dias", "prenotacao"],
        source: "standard_v2",
      },
      {
        category: "titulo",
        subcategory: "financiamento",
        title: "Diferença de Valor Liberado pelo Agente Financeiro",
        groupCode: "G4",
        isVariable: true,
        content: `<p>Na hipótese de concessão e liberação, pelo Agente Financeiro, de valor menor ao contratado, a diferença será paga pelo(s) PROMISSÁRIO(S) COMPRADOR(ES) aos PROMITENTES VENDEDORES no ato da assinatura do Contrato de Financiamento, de maneira a perfazer o montante total do preço de venda, excetuando-se eventual correção monetária liberada pelo Agente Financeiro, nos termos do art. 22 da Resolução BCB 4.676/2018.</p>`,
        agentNotes: "Incluir sempre. A referência à Resolução BCB 4.676/2018 é precisa para justificar a exceção da correção monetária liberada pelo banco.",
        tags: ["financiamento", "diferenca-valor", "resolucao-bcb", "agente-financeiro"],
        source: "standard_v2",
      },
      {
        category: "titulo",
        subcategory: "financiamento",
        title: "Abatimento de Saldo Devedor do Vendedor",
        groupCode: "G4",
        isVariable: true,
        content: `<p>Considerando o saldo devedor existente dos PROMITENTES VENDEDORES junto à instituição financeira {{config.banco_financiamento}}, no valor aproximado de {{moeda config.saldo_devedor_vendedor}}, atualizado até {{config.data_referencia_saldo}}, quando da liberação do financiamento pelo Agente Financeiro, referida quantia será abatida automaticamente pela própria instituição, recebendo os PROMITENTES VENDEDORES apenas o saldo remanescente.</p>`,
        agentNotes: "O valor do saldo devedor deve ser verificado com certidão atualizada junto ao banco. A variação de juros entre a data de referência e a quitação é de responsabilidade dos vendedores. Usar quando imóvel tem saldo devedor.",
        tags: ["financiamento", "saldo-devedor", "abatimento", "banco"],
        source: "standard_v2",
      },
      {
        category: "titulo",
        subcategory: "financiamento",
        title: "Suspensão por Nota de Exigência do Cartório",
        groupCode: "G4",
        isVariable: true,
        content: `<p>Na hipótese de emissão de Nota de Exigência/Devolutiva pelo Cartório de Registro de Imóveis, os prazos estabelecidos neste instrumento ficarão suspensos pelo período necessário à resolução das pendências, sem penalidades às partes.</p>`,
        agentNotes: "Cláusula de proteção bilateral contra morosidade cartorária. Sem esta cláusula, o comprador pode ser penalizado por atrasos que estão fora de seu controle.",
        tags: ["financiamento", "nota-exigencia", "cartorio", "suspensao-prazos"],
        source: "standard_v2",
      },
      // ========== G5 - COMISSÃO DE CORRETAGEM ==========
      {
        category: "comissao",
        subcategory: "corretagem",
        title: "Comissão Atrelada ao Financiamento",
        groupCode: "G5",
        isVariable: true,
        content: `<p>A comissão de corretagem devida à INTERMEDIADORA, no valor de {{moeda comissao.valor}} ({{extenso comissao.valor}}), será paga pelos PROMITENTES VENDEDORES por ocasião do recebimento da parcela prevista na alínea "b" da Cláusula Segunda. Em caso de rescisão, a responsabilidade pelo pagamento da intermediação será daquele que tenha dado causa, nos termos do art. 723 e seguintes do Código Civil.</p>`,
        agentNotes: "Padrão Zimmermann: comissão atrelada à liberação do financiamento. O momento do pagamento da comissão deve ser claro para evitar conflito com a cláusula de rescisão. Usar em contratos com financiamento.",
        tags: ["comissao", "financiamento", "art-723", "corretagem"],
        source: "standard_v2",
      },
      {
        category: "comissao",
        subcategory: "corretagem",
        title: "Split de Cobrança Bancária",
        groupCode: "G5",
        isVariable: true,
        content: `<p>As partes ajustam que a intermediadora, seus colaboradores e parceiros poderão emitir uma cobrança bancária única no valor total da comissão, que, uma vez paga, fará automaticamente a divisão interna através da tecnologia de split, sendo que as cobranças (boletos ou, na sua falta, contas bancárias) serão encaminhadas através de e-mail com o domínio @{{comissao.dominio_imobiliaria}}. Os destinatários e respectivos valores constam do Anexo de Distribuição de Comissão deste instrumento.</p>`,
        agentNotes: "Mecanismo de split utilizado pela Zimmermann. Transparente para as partes e juridicamente seguro quando os destinatários estão identificados.",
        tags: ["comissao", "split", "cobranca", "distribuicao"],
        source: "standard_v2",
      },
      {
        category: "comissao",
        subcategory: "corretagem",
        title: "Declaração de Não Exclusividade",
        groupCode: "G5",
        isVariable: true,
        content: `<p>Os PROMITENTES VENDEDORES declaram que não há contrato de exclusividade vigente com outra imobiliária ou corretor de imóveis referente ao IMÓVEL objeto do negócio.</p>`,
        agentNotes: "Incluir sempre. Protege a intermediadora de disputas de comissão com terceiros e os vendedores de dupla obrigação.",
        tags: ["comissao", "exclusividade", "declaracao", "protecao"],
        source: "standard_v2",
      },
      // ========== G6 - DECLARAÇÕES E DISPOSIÇÕES ESPECIAIS ==========
      {
        category: "foro",
        subcategory: "declaracoes",
        title: "Aptidão para Financiamento",
        groupCode: "G6",
        isVariable: true,
        content: `<p>O(s) PROMISSÁRIO(S) COMPRADOR(ES) declara(m) estar apto(s) a atender aos requisitos necessários ao trâmite, concessão e liberação dos recursos de financiamento imobiliário destinados ao pagamento da parcela prevista na alínea "b" da cláusula de preço.</p>`,
        agentNotes: "Inserir sempre em contratos com financiamento. Cria responsabilidade do comprador pela não aprovação decorrente de suas condições cadastrais.",
        tags: ["declaracao", "aptidao", "financiamento", "comprador"],
        source: "standard_v2",
      },
      {
        category: "foro",
        subcategory: "declaracoes",
        title: "Contratação Eletrônica",
        groupCode: "G6",
        isVariable: true,
        content: `<p>As partes reconhecem a forma de contratação por meios eletrônicos, digitais e informáticos como válida e plenamente eficaz, constituindo título executivo extrajudicial para todos os fins de direito, conforme disposto pelo art. 10 da Medida Provisória n.º 2.200/2001. O contrato considerar-se-á assinado somente após a assinatura de todas as partes na plataforma de assinatura eletrônica, com a disponibilização do certificado de assinatura, sendo devido o pagamento da parcela de sinal somente a partir deste momento.</p>`,
        agentNotes: "Vincular o início da obrigação de pagar o sinal à conclusão do processo de assinatura eletrônica. Importante em contratos firmados por Docusign, Clicksign, D4Sign etc.",
        tags: ["declaracao", "eletronica", "mp-2200", "assinatura-digital"],
        source: "standard_v2",
      },
      {
        category: "foro",
        subcategory: "declaracoes",
        title: "Declaração de Sócio de Pessoa Jurídica",
        groupCode: "G6",
        isVariable: true,
        content: `<p>O(s) PROMITENTE(S) VENDEDOR(ES) {{config.nome_vendedor_socio}}, na qualidade de sócio(s) da empresa {{config.nome_empresa_socio}}, CNPJ {{config.cnpj_empresa_socio}}, declara(m) que não existe(m) na pessoa jurídica quaisquer questões judiciais capazes de onerar e/ou inviabilizar a presente transação. Os demais PROMITENTES VENDEDORES declaram não possuir participação societária em qualquer pessoa jurídica no território nacional.</p>`,
        agentNotes: "Usar quando algum vendedor é sócio de PJ. A declaração de ausência de pendências judiciais na empresa é relevante para blindar a operação contra fraude contra credores e desconsideração da personalidade jurídica.",
        tags: ["declaracao", "socio", "pj", "personalidade-juridica"],
        source: "standard_v2",
      },
      {
        category: "foro",
        subcategory: "declaracoes",
        title: "Não Modificação das Condições Contratadas",
        groupCode: "G6",
        isVariable: true,
        content: `<p>As condições pactuadas neste instrumento deverão ser cumpridas tal como redigidas. Qualquer omissão ou tolerância de qualquer das partes em exigir o cumprimento das obrigações ora convencionadas será por mera liberalidade, não constituindo modificação das condições contratadas, nem renúncia de direitos, os quais poderão ser exercidos a qualquer tempo pelo seu titular.</p>`,
        agentNotes: "Cláusula importante para evitar que condutas de tolerância durante a execução do contrato sejam invocadas como novação tácita ou renúncia de direitos.",
        tags: ["declaracao", "nao-modificacao", "tolerancia", "liberalidade"],
        source: "standard_v2",
      },
      {
        category: "preco",
        subcategory: "fgts",
        title: "Pagamento via FGTS",
        groupCode: "G6",
        isVariable: true,
        content: `<p>Parte do preço previsto na Cláusula de Preço, no valor de {{moeda pagamento.fgts}} ({{extenso pagamento.fgts}}), será pago mediante saque do Fundo de Garantia por Tempo de Serviço (FGTS) do(s) PROMISSÁRIO(S) COMPRADOR(ES), nos termos da Lei n.º 8.036/1990 e das Resoluções do Conselho Curador do FGTS. O(s) PROMISSÁRIO(S) COMPRADOR(ES) comprometem-se a dar entrada no processo de habilitação do FGTS junto à Caixa Econômica Federal no prazo de 10 dias corridos da assinatura deste instrumento.</p>`,
        agentNotes: "Verificar as regras vigentes da CEF: valor máximo do imóvel, número de imóveis do comprador, tempo mínimo de trabalho sob FGTS e enquadramento no programa. Inserir quando pagamento.fgts > 0.",
        tags: ["fgts", "caixa", "lei-8036", "saque"],
        source: "standard_v2",
      },
    ];

    for (const clause of clauseBankV2) {
      await prisma.clause.create({
        data: {
          orgId: org.id,
          ...clause,
          status: "approved",
        },
      });
    }
    console.log(`${clauseBankV2.length} standard v2 clauses seeded`);
  }

  // 6. Seed agent config
  const existingConfig = await prisma.agentConfig.findUnique({
    where: { orgId: org.id },
  });
  if (!existingConfig) {
    await prisma.agentConfig.create({
      data: {
        orgId: org.id,
        model: "claude-sonnet-4-20250514",
        ocrModel: "claude-haiku-4-5-20251001",
        temperature: 0.3,
        maxTokens: 4096,
        systemPrompt: `Você é um assistente jurídico especializado em contratos imobiliários brasileiros. Atua como advogado sênior revisando contratos.

REGRAS:
1. RIGOR LINGUÍSTICO: Norma culta, acentuação e terminologia jurídica impecáveis.
2. CONSULTA OBRIGATÓRIA: Sempre consulte query_clauses antes de criar ou alterar cláusulas.
3. ANÁLISE CRÍTICA: Verifique contradições, consistência de valores e dados pessoais.
4. BASE LEGAL: Cite artigos do Código Civil, Lei 8.245/91, Lei 9.307/96, LGPD.
5. PROTEÇÃO DAS PARTES: Sugira cláusulas protetivas faltantes.
6. FORMATO: Use Handlebars ({{moeda}}, {{cpf}}, {{cnpj}}, {{cep}}, {{dataExtenso}}, {{extenso}}).
7. BLOQUEIO: Recuse alterações em contratos aprovados.
8. IDIOMA: Respostas em português brasileiro.`,
      },
    });
    console.log("Agent config seeded");
  }

  console.log("Seed completed!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
