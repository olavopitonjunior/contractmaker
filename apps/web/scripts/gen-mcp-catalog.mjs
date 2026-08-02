/**
 * Gera o catálogo de tools do MCP server (apps/mcp-server) pro console de
 * agentes exibir na aba Tools do Max — sem importar o módulo do sidecar no
 * bundle do Next (ele puxa child_process e o client da bridge).
 *
 * Extrai SÓ os nomes, de propósito: as descrições são strings multi-linha
 * concatenadas e parseá-las por regex produziria texto silenciosamente
 * truncado — nome errado numa tela de auditoria é pior que nome sozinho.
 *
 * Uso: node apps/web/scripts/gen-mcp-catalog.mjs
 * O drift é vigiado por teste (mcp-catalog.test.ts) — mesmo regex, compara
 * o gerado com o fonte e falha se alguém adicionar tool sem regenerar.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..", "..", "mcp-server", "src", "tools.ts");
const target = join(here, "..", "src", "lib", "ai", "agents", "mcp-catalog.generated.ts");

export function extractToolNames(code) {
  const names = [];
  for (const m of code.matchAll(/^ {4}name: "([^"]+)",$/gm)) names.push(m[1]);
  return names;
}

const names = extractToolNames(readFileSync(source, "utf8"));
if (names.length === 0) {
  console.error("gen-mcp-catalog: nenhum nome extraído — o formato do tools.ts mudou?");
  process.exit(1);
}

const banner = `/**
 * GERADO por scripts/gen-mcp-catalog.mjs — NÃO editar à mão.
 * Fonte: apps/mcp-server/src/tools.ts. Regenerar: npm run gen:mcp-catalog.
 * Drift vigiado por mcp-catalog.test.ts.
 */
export const MCP_TOOL_NAMES: readonly string[] = [
`;
const body = names.map((n) => `  ${JSON.stringify(n)},`).join("\n");
writeFileSync(target, `${banner}${body}\n];\n`, "utf8");
console.log(`gen-mcp-catalog: ${names.length} tools → ${target}`);
