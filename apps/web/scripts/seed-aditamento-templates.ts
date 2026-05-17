#!/usr/bin/env tsx
/**
 * F4 iteração 2026-05-17 — Popula KnowledgeItem com 7 modelos seed de
 * aditamento contratual. O Editor consulta esses modelos via
 * `query_knowledge_base(category="model", query="aditamento <kind>")`
 * antes de gerar redação inédita, garantindo consistência jurídica.
 *
 * Idempotente: usa `upsert` baseado em (orgId, title) — re-rodar não
 * duplica. Embeddings Voyage rodam apenas em rows novas (skip se já tem).
 *
 * Uso:
 *   pnpm -F web tsx scripts/seed-aditamento-templates.ts            # todas orgs
 *   pnpm -F web tsx scripts/seed-aditamento-templates.ts --org=<id> # uma org
 *
 * Custo: ~$0.001 por org (7 embeddings × ~500 tokens × $0.12/M tokens).
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(): void {
  const envPath = resolve(__dirname, "..", ".env");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile();

import { prisma } from "../src/lib/db/prisma";
import { embedOne, toPgVector, isEmbeddingsConfigured } from "../src/lib/ai/embeddings";

interface SeedTemplate {
  /** Slug que casa com finding.kind. Editor busca por "aditamento <slug>". */
  kind: string;
  title: string;
  /** Tags pra filtragem futura na UI/queries categorizadas. */
  tags: string[];
  /** Conteúdo Markdown — o Handlebars renderer respeita pra montar
   *  aditamento_v2.hbs. */
  content: string;
}

const SEEDS: SeedTemplate[] = [
  {
    kind: "matricula_onus",
    title: "aditamento:matricula_onus — Quitação de Ônus Reais Antes da Escritura",
    tags: ["aditamento", "matricula", "onus", "penhora", "alienacao_fiduciaria", "CC_418", "CC_474"],
    content: `**Modelo de aditamento para matrícula com ônus reais (penhora, indisponibilidade ou alienação fiduciária):**

Considerando que a certidão de inteiro teor atualizada da matrícula do IMÓVEL objeto deste compromisso registra a existência de {ônus/penhora/alienação fiduciária} em favor de {credor}, as partes pactuam o seguinte aditamento:

CLÁUSULA 1ª — DO OBJETO
O presente aditamento tem por objeto estabelecer obrigação de quitação dos gravames registrados na matrícula como condição resolutiva do contrato originário.

CLÁUSULA 2ª — DA ALTERAÇÃO
2.1. O VENDEDOR declara estar ciente da existência de {ônus/penhora/alienação fiduciária} registrada na matrícula e obriga-se, sob pena de rescisão automática e devolução em dobro do sinal recebido (Código Civil, art. 418), a quitar e providenciar o cancelamento de todos os gravames antes da lavratura da escritura pública definitiva, no prazo máximo de {30} dias úteis contados deste aditamento.

2.2. O COMPRADOR fica autorizado a reter, até a data da apresentação da matrícula totalmente livre e desembaraçada, valor equivalente ao débito apurado, mediante depósito judicial ou em conta vinculada conjunta.

2.3. Caso o VENDEDOR não promova a baixa dos gravames no prazo estipulado, o contrato originário e o presente aditamento poderão ser resolvidos pelo COMPRADOR independentemente de notificação judicial, restituindo-se-lhe em dobro o sinal pago (CC art. 418), sem prejuízo de perdas e danos.

CLÁUSULA 3ª — DA BASE LEGAL
- Código Civil, art. 127 (negócio jurídico subordinado a condição resolutiva)
- Código Civil, art. 418 (devolução em dobro do sinal)
- Código Civil, art. 474 (cláusula resolutiva expressa)
- Código Civil, art. 502 (responsabilidade do vendedor por vícios da coisa)
- Lei 13.097/2015, art. 54 (concentração dos atos na matrícula)`,
  },
  {
    kind: "matricula_faltando",
    title: "aditamento:matricula_faltando — Condição Suspensiva de Apresentação de Matrícula",
    tags: ["aditamento", "matricula", "condicao_suspensiva", "CC_125"],
    content: `**Modelo de aditamento para CCV sem matrícula atualizada apresentada:**

CLÁUSULA 2ª — DA ALTERAÇÃO
2.1. O VENDEDOR obriga-se a apresentar, em até 5 (cinco) dias úteis contados da assinatura deste aditamento, certidão de inteiro teor atualizada da matrícula do IMÓVEL emitida pelo Cartório de Registro de Imóveis competente, na qual conste expressamente a inexistência de ônus reais, gravames, indisponibilidades ou ações em andamento.

2.2. A não apresentação no prazo constitui condição resolutiva, restituindo ao COMPRADOR todos os valores pagos a título de sinal, sem prejuízo das perdas e danos eventualmente apurados.

CLÁUSULA 3ª — DA BASE LEGAL
- Código Civil, art. 125 (condição suspensiva)
- Código Civil, art. 474 e 475 (resolução por inadimplemento)
- Lei 13.097/2015, art. 54`,
  },
  {
    kind: "vendedor_fiscal_positiva",
    title: "aditamento:vendedor_fiscal_positiva — Quitação Fiscal Antes da Escritura",
    tags: ["aditamento", "fiscal", "PGFN", "CND", "CC_502", "CC_503"],
    content: `**Modelo de aditamento para vendedor com certidão fiscal positiva (PGFN/Receita Federal/SEFAZ):**

CLÁUSULA 2ª — DA ALTERAÇÃO
2.1. O VENDEDOR reconhece a existência de débitos fiscais (referência: {certidão}) e obriga-se a quitá-los antes da lavratura da escritura pública definitiva, apresentando ao COMPRADOR comprovante de regularização no prazo de 30 (trinta) dias contados deste aditamento.

2.2. O não cumprimento dentro do prazo configura inadimplemento contratual, facultando ao COMPRADOR optar:
  (a) pela rescisão do contrato originário com devolução em dobro do sinal (CC art. 418);
  (b) pela quitação direta do débito com retenção do valor correspondente do preço total devido ao VENDEDOR;
  (c) pela manutenção do contrato com extensão do prazo, condicionada à apresentação de garantia adicional pelo VENDEDOR.

2.3. Eventuais débitos não declarados e descobertos após a transmissão da propriedade serão de responsabilidade exclusiva do VENDEDOR, com direito de regresso pelo COMPRADOR.

CLÁUSULA 3ª — DA BASE LEGAL
- Código Civil, arts. 502 e 503 (responsabilidade por vícios e evicção)
- Código Civil, art. 418 (devolução em dobro do sinal)
- Código Civil, art. 475 (resolução por inadimplemento)`,
  },
  {
    kind: "vendedor_trabalhista_positiva",
    title: "aditamento:vendedor_trabalhista_positiva — Garantia de Evicção Trabalhista",
    tags: ["aditamento", "trabalhista", "CNDT", "evicção", "penhora_trabalhista"],
    content: `**Modelo de aditamento para vendedor com certidão trabalhista positiva:**

CLÁUSULA 2ª — DA ALTERAÇÃO
2.1. Considerando que o VENDEDOR possui registro positivo em certidão trabalhista (referência: {certidão CNDT/TRT}), as partes acordam que, na hipótese de penhora trabalhista superveniente sobre o IMÓVEL antes do registro da escritura definitiva, fica configurada hipótese de evicção integral.

2.2. Em caso de evicção, o VENDEDOR responderá:
  (a) pela devolução integral de todos os valores pagos pelo COMPRADOR, atualizados monetariamente desde cada desembolso pelo IPCA-E ou índice oficial sucedâneo;
  (b) pelas perdas e danos efetivamente apurados, incluindo custos com escritura, ITBI eventualmente pago, taxas cartorárias e honorários advocatícios;
  (c) pelo valor de eventuais benfeitorias úteis e necessárias realizadas pelo COMPRADOR no IMÓVEL.

2.3. O VENDEDOR autoriza, desde já, o COMPRADOR a reter, do saldo a quitar, valor de até {percentual/quantia} a título de garantia, depositado em conta vinculada conjunta até a baixa do(s) processo(s) trabalhista(s).

CLÁUSULA 3ª — DA BASE LEGAL
- Código Civil, arts. 447 a 457 (evicção)
- Código Civil, art. 502 (vícios redibitórios)
- CLT, art. 879 e ss. (penhora trabalhista)`,
  },
  {
    kind: "imovel_iptu_pendente",
    title: "aditamento:imovel_iptu_pendente — Quitação de Débitos Municipais",
    tags: ["aditamento", "iptu", "municipal", "tributos_imovel", "CC_502", "CC_503"],
    content: `**Modelo de aditamento para imóvel com débitos municipais (IPTU/taxas):**

CLÁUSULA 2ª — DA ALTERAÇÃO
2.1. O VENDEDOR obriga-se a quitar integralmente os débitos municipais incidentes sobre o IMÓVEL (IPTU, taxas e tributos municipais até a data da imissão de posse), apresentando ao COMPRADOR a respectiva certidão negativa de débitos municipais antes da escritura definitiva, no prazo de {15} dias úteis contados deste aditamento.

2.2. Eventuais débitos não declarados e descobertos após a transmissão da propriedade serão de responsabilidade exclusiva do VENDEDOR, com direito de regresso pelo COMPRADOR pelos valores efetivamente pagos a esse título, acrescidos de juros e correção monetária.

2.3. Em caso de inadimplemento no prazo do item 2.1, fica autorizado ao COMPRADOR efetuar o pagamento direto perante a Prefeitura Municipal competente e reter o valor correspondente do saldo do preço.

CLÁUSULA 3ª — DA BASE LEGAL
- Código Civil, arts. 502 e 503 (vícios redibitórios)
- Código Tributário Nacional, art. 130 (sub-rogação tributária na transmissão)
- Lei 13.097/2015, art. 54`,
  },
  {
    kind: "protesto_vendedor",
    title: "aditamento:protesto_vendedor — Retenção por Protesto Cambial",
    tags: ["aditamento", "protesto", "CENPROT", "retencao"],
    content: `**Modelo de aditamento para vendedor com protesto cambial:**

CLÁUSULA 2ª — DA ALTERAÇÃO
2.1. Constatada a existência de protesto em nome do VENDEDOR (referência: {certidão CENPROT}), as partes pactuam que o COMPRADOR poderá reter, do saldo a quitar, valor equivalente ao montante protestado, depositando-o em conta vinculada conjunta até:
  (a) a apresentação da carta de anuência do credor protestado; OU
  (b) a apresentação de comprovante de cancelamento do protesto perante o cartório respectivo; OU
  (c) o trânsito em julgado de decisão judicial declarando inexigível o débito protestado.

2.2. O VENDEDOR autoriza, desde já, o COMPRADOR a utilizar os valores retidos para quitação direta do(s) protesto(s), caso este não promova a baixa no prazo de {30} dias úteis após a assinatura deste aditamento, sendo o saldo eventualmente remanescente devolvido ao VENDEDOR.

CLÁUSULA 3ª — DA BASE LEGAL
- Código Civil, art. 502 (vícios redibitórios)
- Lei 9.492/1997 (protesto de títulos)
- Código Civil, arts. 396 a 401 (mora)`,
  },
  {
    kind: "fgts_pendente",
    title: "aditamento:fgts_pendente — Regularização CRF FGTS (Pessoa Jurídica)",
    tags: ["aditamento", "fgts", "CRF", "Lei_8036_1990", "vendedor_PJ"],
    content: `**Modelo de aditamento para vendedor pessoa jurídica com CRF FGTS irregular:**

CLÁUSULA 2ª — DA ALTERAÇÃO
2.1. O VENDEDOR, pessoa jurídica acima qualificada, declara a existência de irregularidade no Certificado de Regularidade do FGTS (CRF) e compromete-se a regularizar a situação perante a Caixa Econômica Federal antes da lavratura da escritura definitiva, no prazo máximo de {20} dias úteis contados deste aditamento.

2.2. O VENDEDOR apresentará ao COMPRADOR o CRF regular como condição para a escritura, sob pena de o COMPRADOR optar pela rescisão sem penalidade, com restituição integral dos valores pagos atualizados pelo IPCA-E.

2.3. A irregularidade do CRF não impede o COMPRADOR de utilizar recursos próprios e/ou de financiamento bancário pra quitação do preço, mas o VENDEDOR fica responsabilizado por eventuais autuações ou cobranças supervenientes relacionadas a esse passivo.

CLÁUSULA 3ª — DA BASE LEGAL
- Lei 8.036/1990, art. 27 (CRF e exigibilidade)
- Código Civil, arts. 502 e 503 (vícios da coisa)
- Código Civil, art. 475 (resolução por inadimplemento)`,
  },
];

const SHARED_ORG_ID = process.env.SHARED_ORG_ID ?? "cmnt1ldo4000111bw4yo517k0";

async function main() {
  const argOrg = process.argv.find((a) => a.startsWith("--org="))?.split("=")[1];
  const orgs = argOrg
    ? [{ id: argOrg }]
    : await prisma.organization.findMany({ select: { id: true } });

  if (orgs.length === 0) {
    console.error("❌ Nenhuma org encontrada — passe --org=<id> ou popule a tabela Organization.");
    process.exit(1);
  }

  console.log(`🌱 Seeding ${SEEDS.length} aditamento templates em ${orgs.length} org(s)…\n`);

  const voyageEnabled = isEmbeddingsConfigured();
  if (!voyageEnabled) {
    console.warn(
      "⚠️  VOYAGE_API_KEY ausente — seeds vão ser criados mas SEM embedding. " +
        "`query_knowledge_base` cai em fallback ILIKE pra esses items. " +
        "Rotacione a chave e rode `scripts/reembed-knowledge-base.ts` depois (futuro)."
    );
  }

  let totalCreated = 0;
  let totalUpdated = 0;
  let totalEmbedded = 0;

  for (const org of orgs) {
    for (const seed of SEEDS) {
      const existing = await prisma.knowledgeItem.findFirst({
        where: { orgId: org.id, title: seed.title },
        select: { id: true },
      });

      const data = {
        orgId: org.id,
        category: "model",
        title: seed.title,
        content: seed.content,
        chunkIndex: 0,
        chunkTotal: 1,
        tags: [...seed.tags, `kind:${seed.kind}`],
        source: "seed:aditamento-v1",
      };

      let itemId: string;
      if (existing) {
        await prisma.knowledgeItem.update({
          where: { id: existing.id },
          data,
        });
        itemId = existing.id;
        totalUpdated++;
        console.log(`  ↻ updated  org=${org.id.slice(0, 8)}… kind=${seed.kind}`);
      } else {
        const created = await prisma.knowledgeItem.create({ data });
        itemId = created.id;
        totalCreated++;
        console.log(`  ✓ created  org=${org.id.slice(0, 8)}… kind=${seed.kind}`);
      }

      // Embedding (Voyage)
      if (voyageEnabled) {
        try {
          const vector = await embedOne(seed.content, "document");
          const pgvector = toPgVector(vector);
          await prisma.$executeRawUnsafe(
            `UPDATE "KnowledgeItem" SET embedding = $1::vector WHERE id = $2`,
            pgvector,
            itemId
          );
          totalEmbedded++;
        } catch (err) {
          console.error(`    ⚠️  embedding falhou (${seed.kind}):`, err instanceof Error ? err.message : err);
        }
      }
    }
  }

  console.log("\n📊 Resumo:");
  console.log(`   Criados: ${totalCreated}`);
  console.log(`   Atualizados: ${totalUpdated}`);
  console.log(`   Embeddings persistidos: ${totalEmbedded}`);
  console.log("\n✅ Seed concluído.");
  console.log(`   Editor agora consulta via query_knowledge_base(category="model", query="aditamento <kind>")`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("❌ Seed falhou:", err);
  await prisma.$disconnect();
  process.exit(1);
});
