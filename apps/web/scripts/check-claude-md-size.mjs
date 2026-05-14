#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const LIMIT = 40_000;
const target = process.argv[2] ?? "CLAUDE.md";
const path = resolve(process.cwd(), target);

try {
  const content = readFileSync(path, "utf8");
  const charCount = content.length;
  const byteCount = statSync(path).size;

  if (charCount > LIMIT) {
    console.error(`✗ ${target} tem ${charCount} caracteres (limite: ${LIMIT}).`);
    console.error(`  Mova conteúdo pra MEMORY.md ou docs/ antes de continuar.`);
    process.exit(2);
  }

  console.log(`✓ ${target}: ${charCount} chars (${byteCount} bytes) — dentro do limite de ${LIMIT}.`);
} catch (err) {
  if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
    process.exit(0);
  }
  console.error(`Erro lendo ${target}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
