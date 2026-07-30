/**
 * Codegen: embarca o conteúdo dos `.hbs` canônicos num módulo TS.
 *
 * POR QUÊ (restrição Vercel): `templates/` vive na RAIZ do monorepo, FORA de
 * `apps/web`. Numa serverless function o `process.cwd()` é a raiz do app Next
 * (`apps/web`) e o file tracing do Next só varre o que está dentro do projeto +
 * node_modules — logo `fs.readFile("../../templates/x.hbs")` não resolve e o
 * arquivo nem sobe no bundle. Embarcar o conteúdo em TS é o único caminho que
 * não depende de config de tracing (que o repo não usa em nenhum lugar).
 *
 * Uso:
 *   npm run gen:canonical-templates            # regenera
 *   npm run gen:canonical-templates -- --check  # só valida (exit 1 se drift)
 *
 * O drift também é pego por `src/lib/templates/__tests__/canonical-seed.test.ts`.
 */
import fs from "node:fs";
import path from "node:path";
import { CANONICAL_TEMPLATES } from "../src/lib/templates/canonical-templates";

const CHECK_ONLY = process.argv.includes("--check");

const OUT_FILE = path.join(
  __dirname,
  "..",
  "src",
  "lib",
  "templates",
  "canonical-sources.generated.ts"
);

// Não exportar: este módulo escreve arquivo no top-level (é um CLI).
function resolveTemplatePath(filename: string): string {
  const candidates = [
    path.join(process.cwd(), "..", "..", "templates", filename),
    path.join(process.cwd(), "templates", filename),
    path.join(__dirname, "..", "..", "..", "templates", filename),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(`Template file not found: ${filename}`);
}

function render(): string {
  const entries = CANONICAL_TEMPLATES.map((t) => {
    const source = fs.readFileSync(resolveTemplatePath(t.filename), "utf-8");
    // JSON.stringify escapa tudo (backtick, ${, \n) sem surpresa de template literal.
    return `  ${JSON.stringify(t.filename)}: ${JSON.stringify(source)},`;
  });

  return [
    "// GERADO AUTOMATICAMENTE — não editar à mão.",
    "// Fonte: templates/*.hbs (raiz do repo) via",
    "// `npm run gen:canonical-templates`. Ver o header do script pra entender por",
    "// que o conteúdo é embarcado em vez de lido com fs em runtime.",
    "",
    "export const CANONICAL_TEMPLATE_SOURCES: Record<string, string> = {",
    ...entries,
    "};",
    "",
  ].join("\n");
}

const next = render();
const current = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, "utf-8") : "";

if (CHECK_ONLY) {
  if (next !== current) {
    console.error(
      "[gen:canonical-templates] DRIFT: canonical-sources.generated.ts está " +
        "desatualizado. Rode `npm run gen:canonical-templates`."
    );
    process.exit(1);
  }
  console.log("[gen:canonical-templates] OK — sem drift.");
} else if (next === current) {
  console.log("[gen:canonical-templates] já atualizado (nenhuma mudança).");
} else {
  fs.writeFileSync(OUT_FILE, next, "utf-8");
  console.log(
    `[gen:canonical-templates] escrito ${OUT_FILE} (${CANONICAL_TEMPLATES.length} templates, ${next.length} chars)`
  );
}
