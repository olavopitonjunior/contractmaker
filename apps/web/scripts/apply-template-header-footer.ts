/**
 * Aplica header + footer padronizados em um Google Doc template via Docs API.
 *
 * Uso:
 *   npx ts-node scripts/apply-template-header-footer.ts \
 *     --templateDocId=<id-do-Google-Doc>
 *
 * Idempotente: se o doc já tem header/footer, pula a criação e só atualiza
 * o conteúdo. Header carrega `{{comissao.imobiliaria_nome}}` (esquerda) e
 * `Contrato {{contrato.numero}}` (direita). Footer central com page number.
 *
 * Aplique nos 2 templates Zimmermann depois de polir tipografia:
 *   npx ts-node scripts/apply-template-header-footer.ts \
 *     --templateDocId=1oajGsfWSmjZKGWTKQ7vzVVkafxzR0M6G0PSyO03nBHk
 *   npx ts-node scripts/apply-template-header-footer.ts \
 *     --templateDocId=1hYZDXG1FYkVXNdh7l5qllUw1maeT13L7_KPnqfITGfE
 */

// Load .env (ts-node doesn't honor --env-file)
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

import { batchUpdateDoc, getDocStructure } from "../src/lib/google/docs";
import type { docs_v1 } from "googleapis";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found?.slice(prefix.length);
}

async function main() {
  const docId = arg("templateDocId");
  if (!docId) {
    console.error("Uso: --templateDocId=<id>");
    process.exit(1);
  }

  console.log(`Aplicando header/footer em ${docId}…`);

  const doc = await getDocStructure(docId);
  const headerExists = !!Object.keys(doc.headers || {}).length;
  const footerExists = !!Object.keys(doc.footers || {}).length;

  console.log(`Header existente: ${headerExists ? "sim" : "não"}`);
  console.log(`Footer existente: ${footerExists ? "sim" : "não"}`);

  // 1. Cria header e footer se não existirem
  if (!headerExists || !footerExists) {
    const createReqs: docs_v1.Schema$Request[] = [];
    if (!headerExists) {
      createReqs.push({ createHeader: { type: "DEFAULT" } });
    }
    if (!footerExists) {
      createReqs.push({ createFooter: { type: "DEFAULT" } });
    }
    await batchUpdateDoc(docId, createReqs);
    console.log("✓ Header/footer criados");
  }

  // Re-busca o doc pra pegar os ids gerados
  const updated = await getDocStructure(docId);
  const headerId = Object.keys(updated.headers || {})[0];
  const footerId = Object.keys(updated.footers || {})[0];

  if (!headerId || !footerId) {
    console.error("Falha ao obter ids de header/footer");
    process.exit(1);
  }

  // 2. Limpa conteúdo existente do header e footer (caso re-rodando o script)
  const headerLen = textLengthInSegment(updated.headers?.[headerId]);
  const footerLen = textLengthInSegment(updated.footers?.[footerId]);

  const cleanReqs: docs_v1.Schema$Request[] = [];
  if (headerLen > 1) {
    cleanReqs.push({
      deleteContentRange: {
        range: {
          segmentId: headerId,
          startIndex: 0,
          endIndex: headerLen - 1,
        },
      },
    });
  }
  if (footerLen > 1) {
    cleanReqs.push({
      deleteContentRange: {
        range: {
          segmentId: footerId,
          startIndex: 0,
          endIndex: footerLen - 1,
        },
      },
    });
  }
  if (cleanReqs.length) {
    await batchUpdateDoc(docId, cleanReqs);
    console.log("✓ Conteúdo antigo de header/footer limpo");
  }

  // 3. Insere conteúdo novo
  // Header: tab para alinhar nome à esquerda e contrato à direita
  const headerText = "{{comissao.imobiliaria_nome}}\tContrato {{contrato.numero}}";
  // Footer: placeholder de página inserido como auto text
  const footerText = "Página ";

  await batchUpdateDoc(docId, [
    {
      insertText: {
        text: headerText,
        location: { segmentId: headerId, index: 0 },
      },
    },
    {
      insertText: {
        text: footerText,
        location: { segmentId: footerId, index: 0 },
      },
    },
    // Centraliza o footer
    {
      updateParagraphStyle: {
        range: {
          segmentId: footerId,
          startIndex: 0,
          endIndex: footerText.length,
        },
        paragraphStyle: { alignment: "CENTER" },
        fields: "alignment",
      },
    },
    // Texto do header em fonte pequena cinza
    {
      updateTextStyle: {
        range: {
          segmentId: headerId,
          startIndex: 0,
          endIndex: headerText.length,
        },
        textStyle: {
          fontSize: { magnitude: 9, unit: "PT" },
          foregroundColor: {
            color: { rgbColor: { red: 0.4, green: 0.4, blue: 0.4 } },
          },
        },
        fields: "fontSize,foregroundColor",
      },
    },
  ]);

  console.log("✓ Header/footer preenchidos");
  console.log("");
  console.log("⚠️  Para a numeração de página automática:");
  console.log("   Abra o doc, posicione o cursor após 'Página ' no rodapé");
  console.log("   Inserir → Números de página (Docs API não oferece isso programaticamente)");
}

function textLengthInSegment(seg: docs_v1.Schema$Header | docs_v1.Schema$Footer | undefined): number {
  if (!seg) return 0;
  let max = 0;
  for (const block of seg.content || []) {
    if (block.endIndex && block.endIndex > max) max = block.endIndex;
  }
  return max;
}

main().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});
