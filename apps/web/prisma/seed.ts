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
            { name: "Novo Lead", color: "#6366f1", position: 0 },
            { name: "Qualificacao", color: "#f59e0b", position: 1 },
            { name: "Proposta", color: "#3b82f6", position: 2 },
            { name: "Contrato", color: "#8b5cf6", position: 3 },
            { name: "Fechado Ganho", color: "#22c55e", position: 4 },
            { name: "Fechado Perdido", color: "#ef4444", position: 5 },
          ],
        },
      },
    });
    console.log("Pipeline created:", pipeline.name);
  }

  // 4. Create default contract template from HBS file
  const templatePath = path.resolve(
    __dirname,
    "../../../templates/contrato_compra_venda.hbs"
  );
  let hbsSource = "";
  try {
    hbsSource = fs.readFileSync(templatePath, "utf-8");
  } catch {
    console.warn("Template HBS file not found at", templatePath);
    hbsSource = "<!-- Template placeholder -->";
  }

  const existingTemplate = await prisma.contractTemplate.findFirst({
    where: { orgId: org.id, isDefault: true },
  });

  if (!existingTemplate) {
    await prisma.contractTemplate.create({
      data: {
        orgId: org.id,
        name: "Compra e Venda de Imovel",
        description:
          "Instrumento particular de compromisso de compra e venda de imovel",
        version: "1.0.0",
        schemaType: "compra_venda_v1",
        handlebarsSource: hbsSource,
        isDefault: true,
        status: "active",
      },
    });
    console.log("Default contract template created");
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
    console.log(`${clauses.length} clauses seeded`);
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
