// Load .env manually since ts-node doesn't honor --env-file
import fs from "fs";
import path from "path";
const envPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf-8")
    .split("\n")
    .forEach((line) => {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*'?([^']*)'?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    });
}

import { createDocFromTemplate } from "../src/lib/google/docs";
import { flattenForGoogleDoc } from "../src/lib/google/placeholders";

async function main() {
  // 2 vendedores + 2 compradores + 1 imóvel pra exercitar REPEAT
  const sample = {
    vendedores: [
      {
        nome: "João da Silva",
        cpf: "12345678901",
        email: "joao@x.com",
        tipo_pessoa: "fisica",
        nacionalidade: "brasileiro",
        estado_civil: "Casado(a)",
        profissao: "engenheiro civil",
        rg: "12345678",
        endereco: "Rua das Flores",
        numero: "200",
        bairro: "Centro",
        cidade: "São Paulo",
        uf: "SP",
        cep: "01000000",
      },
      {
        nome: "Ana Maria da Silva",
        cpf: "22233344455",
        email: "ana@x.com",
        tipo_pessoa: "fisica",
        nacionalidade: "brasileira",
        estado_civil: "Casado(a)",
        profissao: "advogada",
        rg: "87654321",
        endereco: "Rua das Flores",
        numero: "200",
        bairro: "Centro",
        cidade: "São Paulo",
        uf: "SP",
        cep: "01000000",
      },
    ],
    compradores: [
      {
        nome: "Carlos Mendes",
        cpf: "98765432100",
        email: "carlos@x.com",
        tipo_pessoa: "fisica",
        nacionalidade: "brasileiro",
        estado_civil: "Solteiro(a)",
        profissao: "médico",
        rg: "55566677",
        endereco: "Av Paulista",
        numero: "1000",
        cidade: "São Paulo",
        uf: "SP",
        cep: "01310100",
      },
      {
        nome: "Beatriz Mendes",
        cpf: "11122233344",
        email: "bia@x.com",
        tipo_pessoa: "fisica",
        nacionalidade: "brasileira",
        estado_civil: "Solteiro(a)",
        profissao: "arquiteta",
        rg: "99988877",
        endereco: "Av Paulista",
        numero: "1000",
        cidade: "São Paulo",
        uf: "SP",
        cep: "01310100",
      },
    ],
    imoveis: [
      {
        rua: "Rua dos Pinheiros",
        numero: "500",
        bairro: "Pinheiros",
        cidade: "São Paulo",
        uf: "SP",
        cep: "05422000",
        complemento: "Apto 45",
        matricula: "123456",
        cartorio: "5º CRI de São Paulo",
        inscricao_iptu: "098.765.432-1",
        descricao: "Apartamento de 80m² com 2 dormitórios",
      },
    ],
    pagamento: {
      valor_total: 1250000,
      sinal_arras: 50000,
      recursos_proprios: 1200000,
    },
    comissao: {
      imobiliaria_nome: "Imob Contractmaker Teste",
      imobiliaria_cnpj: "12345678000199",
      creci: "12345-J",
      valor: 50000,
    },
    config: {
      data_assinatura: "2026-04-30",
      municipio_imovel: "São Paulo",
      titulo_aquisitivo: "escritura pública de compra e venda",
      registro_aquisitivo: "R-12 da matrícula 123456",
      prazo_posse_dias: 30,
      prazo_escritura_dias: 60,
      multa_diaria_posse: 500,
      multa_diaria_escritura: 300,
    },
    contrato: {
      numero: "TEST-0001-v1",
    },
  };

  const templateId = process.argv.find((a) => a.startsWith("--templateDocId="))?.split("=")[1];
  if (!templateId) {
    console.error("Uso: --templateDocId=<id>");
    process.exit(1);
  }

  const replacements = flattenForGoogleDoc(sample);
  console.log("Generated", Object.keys(replacements).length, "placeholders");
  console.log(
    "Arrays detected: vendedores=" +
      sample.vendedores.length +
      ", compradores=" +
      sample.compradores.length +
      ", imoveis=" +
      sample.imoveis.length
  );

  const result = await createDocFromTemplate({
    templateDocId: templateId,
    name: "SMOKE TEST polished v2 (2 vend + 2 comp + 1 imv)",
    replacements,
    dataForLoops: sample,
  });
  console.log("✓ Doc criado:", result.docId);
  console.log("  URL:", result.webViewLink);
  console.log("  Embed:", result.embedLink);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
