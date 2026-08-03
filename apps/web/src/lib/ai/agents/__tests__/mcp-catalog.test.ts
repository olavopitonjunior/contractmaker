/**
 * Vigia de drift do catálogo MCP — mesmo padrão do canonical-seed dos
 * templates: o arquivo gerado tem que bater com o fonte, senão a aba Tools
 * do Max no console mostra um catálogo que não é o que o sidecar serve.
 * Falhou aqui? `npm run gen:mcp-catalog` e commit.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MCP_TOOL_NAMES } from "../mcp-catalog.generated";

function extractToolNames(code: string): string[] {
  // MESMO regex do gen-mcp-catalog.mjs — mudou lá, muda aqui.
  const names: string[] = [];
  for (const m of code.matchAll(/^ {4}name: "([^"]+)",$/gm)) names.push(m[1]);
  return names;
}

describe("catálogo MCP gerado", () => {
  it("bate com apps/mcp-server/src/tools.ts", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "..", "..", "..", "..", "mcp-server", "src", "tools.ts"),
      "utf8"
    );
    const fresh = extractToolNames(source);
    expect(fresh.length).toBeGreaterThan(0);
    expect([...MCP_TOOL_NAMES]).toEqual(fresh);
  });
});
