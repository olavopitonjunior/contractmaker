/**
 * Recall das checagens semânticas sobre os defeitos medidos em produção —
 * o NÚMERO que decide o R7 (revisor por IA), sem chamar modelo.
 *
 *   npx tsx scripts/ai-bench/placeholders/semantic-recall.ts \
 *     --replay=scripts/ai-bench/placeholders/results-trio-baseline.json \
 *     --corpus-dir=<dir com os .txt do replay> [--case=<prefixo>]
 *
 * Para cada caso do replay: o planejador produz o texto padronizado (de graça,
 * sobre as propostas já pagas), as checagens rodam no texto LIMPO (ruído de
 * base = falsos positivos), e então cada defeito de `semantic-inject.ts` é
 * injetado num texto próprio e as checagens rodam de novo: detectou a
 * categoria esperada no parágrafo esperado (±1)? Recall por classe =
 * detectados / aplicáveis. "n/a" quando o texto não tem a cláusula que a
 * injeção precisa — nunca um zero falso.
 *
 * Critério do plano (03/09/2026): construir o R7 só se o recall determinístico
 * sobre erros semânticos rotulados for < 80% E o revisor por IA somar ≥ 10 pts.
 */
import fs from "fs";
import path from "path";
import { planInsertion } from "@/lib/templates/ai-placeholder-insertion";
import {
  runSemanticChecks,
  type SemanticCategory,
  type SemanticFinding,
} from "@/lib/templates/semantic-checks";
import { INJECTION_KINDS, inject, type InjectionKind } from "@/lib/templates/eval/semantic-inject";

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

/** Mesmo cadastro fictício de `run.ts` (valores realistas de propósito). */
const ORG_FICTICIA = {
  legalName: "Imobiliária Exemplo Ltda",
  cnpj: "11.610.282/0001-65",
  creci: "24.342-J",
  pixAddressKey: "financeiro@exemplo.test",
  bankBranch: "3971-6",
  bankAccount: "58204-3",
};

interface RunRecord {
  file: string;
  modalidade: string;
  mapeamentos: Array<{ token?: string; trecho_literal?: string }>;
}

type Outcome = "hit" | "miss" | "n/a";

interface CaseResult {
  file: string;
  /** Achados no texto limpo, por categoria (ruído de base). */
  baseline: Record<string, number>;
  outcomes: Record<InjectionKind, Outcome>;
  /** Categorias inesperadas que cada injeção provocou além da esperada/permitida. */
  noise: Record<InjectionKind, string[]>;
  /** O que a checagem reportou no parágrafo injetado quando errou (diagnóstico). */
  missDetail: Partial<Record<InjectionKind, string>>;
}

function countBy(findings: SemanticFinding[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of findings) out[f.category] = (out[f.category] ?? 0) + 1;
  return out;
}

function pct(n: number): string {
  return Number.isFinite(n) ? `${(n * 100).toFixed(0)}%` : "—";
}

(async () => {
  const replayFile = arg("replay");
  const corpusDir = arg("corpus-dir");
  if (!replayFile || !corpusDir) {
    console.error("uso: --replay=<results.json> --corpus-dir=<dir> [--case=<prefixo>]");
    process.exit(1);
  }
  const only = arg("case");
  const records = (JSON.parse(fs.readFileSync(path.resolve(replayFile), "utf8")).records as RunRecord[])
    .filter((r) => !only || r.file.startsWith(only));

  const results: CaseResult[] = [];
  for (const rec of records) {
    const docText = fs.readFileSync(path.join(corpusDir, rec.file), "utf8");
    const plan = planInsertion({ docText, modalidade: rec.modalidade, mapeamentos: rec.mapeamentos });
    const clean = plan.simulatedText;
    const base = runSemanticChecks({ docText: clean, modalidade: rec.modalidade, org: ORG_FICTICIA, sourceText: docText });
    const baseCats = new Set(base.findings.map((f) => `${f.category}@${f.paragraphIndex}`));

    const outcomes = {} as Record<InjectionKind, Outcome>;
    const noise = {} as Record<InjectionKind, string[]>;
    const missDetail: Partial<Record<InjectionKind, string>> = {};
    for (const kind of INJECTION_KINDS) {
      const inj = inject(kind, clean, docText, ORG_FICTICIA);
      if (!inj) {
        outcomes[kind] = "n/a";
        noise[kind] = [];
        continue;
      }
      const rep = runSemanticChecks({ docText: inj.text, modalidade: rec.modalidade, org: ORG_FICTICIA, sourceText: docText });
      const hit = rep.findings.some(
        (f) => f.category === inj.expect && Math.abs(f.paragraphIndex - inj.paragraphIndex) <= 1
      );
      outcomes[kind] = hit ? "hit" : "miss";
      // Ruído: achado NOVO (não estava no limpo) de categoria que a injeção não explica.
      const allowed = new Set<SemanticCategory>([inj.expect, ...inj.allowed]);
      noise[kind] = rep.findings
        .filter((f) => !allowed.has(f.category) && !baseCats.has(`${f.category}@${f.paragraphIndex}`))
        .map((f) => `${f.category}@${f.paragraphIndex + 1}`);
      if (!hit) {
        const near = rep.findings
          .filter((f) => Math.abs(f.paragraphIndex - inj.paragraphIndex) <= 1)
          .map((f) => f.category);
        missDetail[kind] = near.length ? `viu ${near.join(",")}` : "nada no parágrafo";
      }
    }
    results.push({ file: rec.file, baseline: countBy(base.findings), outcomes, noise, missDetail });
  }

  // ─── Tabela ──────────────────────────────────────────────────────────────
  const mark = (o: Outcome) => (o === "hit" ? "✓" : o === "miss" ? "✗" : "·");
  const head = INJECTION_KINDS.map((k) => k.slice(0, 9).padEnd(9)).join(" ");
  console.log(`\n${"caso".padEnd(40)} ${head}  base   ruído`);
  console.log("-".repeat(40 + INJECTION_KINDS.length * 10 + 16));
  for (const r of results) {
    const cells = INJECTION_KINDS.map((k) => mark(r.outcomes[k]).padEnd(9)).join(" ");
    const base = Object.entries(r.baseline).map(([k, v]) => `${k}:${v}`).join(" ") || "0";
    const ruido = INJECTION_KINDS.flatMap((k) => r.noise[k].map((n) => `${k.slice(0, 4)}:${n}`)).join(" ") || "0";
    console.log(`${r.file.replace(/\.txt$/, "").slice(0, 39).padEnd(40)} ${cells}  ${base}  ${ruido}`);
  }
  console.log("-".repeat(40 + INJECTION_KINDS.length * 10 + 16));

  // ─── Recall por classe e total ───────────────────────────────────────────
  const perKind: Record<string, { hit: number; applicable: number }> = {};
  for (const k of INJECTION_KINDS) {
    const hit = results.filter((r) => r.outcomes[k] === "hit").length;
    const applicable = results.filter((r) => r.outcomes[k] !== "n/a").length;
    perKind[k] = { hit, applicable };
    console.log(`${k.padEnd(18)} recall ${pct(hit / applicable).padStart(4)}  (${hit}/${applicable})`);
  }
  const totHit = Object.values(perKind).reduce((a, b) => a + b.hit, 0);
  const totApp = Object.values(perKind).reduce((a, b) => a + b.applicable, 0);
  const recall = totHit / totApp;
  const baseNoise = results.reduce((a, r) => a + Object.values(r.baseline).reduce((x, y) => x + y, 0), 0);
  const injNoise = results.reduce((a, r) => a + INJECTION_KINDS.reduce((x, k) => x + r.noise[k].length, 0), 0);
  console.log(`\nRECALL DETERMINÍSTICO: ${pct(recall)} (${totHit}/${totApp} injeções aplicáveis em ${results.length} casos)`);
  console.log(`ruído de base (achados no texto limpo): ${baseNoise} · ruído provocado pelas injeções: ${injNoise}`);
  const misses = results.flatMap((r) =>
    INJECTION_KINDS.filter((k) => r.outcomes[k] === "miss").map((k) => `${r.file.slice(0, 30)} ${k}: ${r.missDetail[k]}`)
  );
  if (misses.length) console.log("\nfalhas:\n  " + misses.join("\n  "));
  console.log(
    recall >= 0.8
      ? "\nCRITÉRIO DO R7: recall ≥ 80% — NÃO construir o revisor por IA; erro novo de produção vira caso gold + regra."
      : "\nCRITÉRIO DO R7: recall < 80% — medir o revisor por IA no mesmo corpus antes de decidir."
  );

  const stamp = process.env.BENCH_STAMP ?? new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const out = path.join(__dirname, `results-semantic-${stamp}.json`);
  fs.writeFileSync(out, JSON.stringify({ stamp, replay: replayFile, recall, perKind, results }, null, 2));
  console.log(`\nresultado em ${path.relative(process.cwd(), out)} (gitignored; sem texto de contrato)`);
})();
