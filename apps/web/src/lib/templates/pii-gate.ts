/**
 * Gate de PII do TEMPLATE (o de cláusula vive em `lib/ingestion/plan-executor.ts`).
 *
 * Por que existe: o passe de IA (`ai-placeholder-insertion`) tokeniza as
 * partes do contrato — locador, locatário, fiador, imóvel — mas não tem chave
 * para tudo que um contrato real carrega. No rebuild da RE/MAX Trio
 * (2026-09-01), 15 de 16 modelos saíram da ingestão com a cláusula de
 * corretagem intacta: nome, CPF, chave PIX, agência e conta de corretores,
 * literais, e o planner só avisava (`pii_leftover`). Ativar um modelo assim
 * imprime o dado de um terceiro em todo contrato gerado a partir dele.
 *
 * O que bloqueia e o que só avisa — decisão deliberada, diferente do gate de
 * cláusula (que é duro em todas as categorias, porque cláusula ganha embedding):
 *
 * - BLOQUEIA: identificador de pessoa (CPF, RG, CNH, PIS) e dado bancário
 *   (agência, conta). Num modelo, nada disso é institucional — é sempre alguém.
 * - AVISA: CNPJ, CEP, telefone e e-mail. Todo modelo timbrado traz os da
 *   própria imobiliária (rodapé, qualificação da administradora); bloquear por
 *   eles travaria 100% das ingestões e o operador aprenderia a forçar.
 *
 * Nome e endereço não têm detector determinístico (só entidade externa, que
 * o template não tem) — ficam fora do gate, e é por isso que a saída
 * consciente (`allowPii`) precisa continuar existindo.
 *
 * O relatório é gravado em `ContractTemplate.draftReport.pii` na ingestão e
 * ESPELHADO a cada revalidação (`validate-gdoc`) e a cada nova passada da IA
 * (`rerun-ai`), que releem o Doc: o gate da ativação confia no relatório, e o
 * relatório confia no último texto lido.
 */
import {
  DEFAULT_MIN_CONFIDENCE,
  detectPii,
  type PiiFinding,
  type PiiKind,
} from "@/lib/ingestion/pii";

/** Categorias que impedem a ativação do modelo. */
export const TEMPLATE_BLOCKING_PII_KINDS: readonly PiiKind[] = [
  "cpf",
  "rg",
  "cnh",
  "pis",
  "bank_agency",
  "bank_account",
];

/** Categorias que só aparecem no relatório — são institucionais num modelo. */
export const TEMPLATE_WARNING_PII_KINDS: readonly PiiKind[] = [
  "cnpj",
  "cep",
  "phone",
  "email",
];

export interface TemplatePiiReport {
  /** `true` quando há ao menos um finding de categoria bloqueante. */
  blocked: boolean;
  /** Categorias bloqueantes encontradas, sem repetição, na ordem de {@link TEMPLATE_BLOCKING_PII_KINDS}. */
  kinds: PiiKind[];
  /** Quantidade de findings bloqueantes. */
  count: number;
  /** Categorias só-aviso encontradas (CNPJ, CEP, telefone, e-mail). */
  warnings: PiiKind[];
  /** Quando o texto foi lido — o relatório vale para ESTE estado do Doc. */
  checkedAt: string;
}

/** Nomes que o operador entende, no lugar das chaves internas. */
export const KIND_LABEL: Record<PiiKind, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  rg: "RG",
  cnh: "CNH",
  pis: "PIS",
  cep: "CEP",
  phone: "telefone",
  email: "e-mail",
  bank_agency: "agência bancária",
  bank_account: "conta bancária",
  person_name: "nome de pessoa",
  address: "endereço",
};

/** Só o que está na tabela de rótulos é uma categoria conhecida. */
export function isPiiKind(v: unknown): v is PiiKind {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(KIND_LABEL, v);
}

export function piiKindLabel(kind: string): string {
  return isPiiKind(kind) ? KIND_LABEL[kind] : kind;
}

/** "CPF, conta bancária" — o MESMO texto na mensagem do 409 e no card da revisão. */
export function describePiiKinds(kinds: readonly string[]): string {
  return kinds.length ? kinds.map(piiKindLabel).join(", ") : "dado pessoal";
}

/**
 * Leitor único de `ContractTemplate.draftReport`: objeto → ele mesmo; qualquer
 * outra coisa (null, array, string) → `{}`. Quem mescla o relatório
 * (ingestão, revalidação, nova passada da IA) parte daqui, para o merge não
 * divergir entre os escritores.
 */
export function readDraftReport(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

/** Mensagem do 409 `PII_UNVERIFIED` — o texto não pôde ser lido para medir. */
export const PII_UNVERIFIED_MESSAGE =
  "Não consegui ler o texto do modelo para conferir se sobrou dado pessoal. " +
  "Revalide o modelo e tente ativar de novo.";

function confidentFindings(findings: readonly PiiFinding[]): PiiFinding[] {
  return findings.filter((f) => f.confidence >= DEFAULT_MIN_CONFIDENCE);
}

/**
 * Audita o texto FINAL do Doc do modelo. Puro: sem I/O, sem banco.
 * Placeholders (`{{chave}}`) e lacunas de minuta (`xxxx`, `____`) não têm
 * dígito válido, então não disparam nenhum detector — o gate mede só o que
 * sobrou literal.
 */
export function auditTemplateText(text: string, now: Date = new Date()): TemplatePiiReport {
  const confident = confidentFindings(detectPii(text));
  const blocking = confident.filter((f) => TEMPLATE_BLOCKING_PII_KINDS.includes(f.kind));
  const kinds = TEMPLATE_BLOCKING_PII_KINDS.filter((k) => blocking.some((f) => f.kind === k));
  const warnings = TEMPLATE_WARNING_PII_KINDS.filter((k) => confident.some((f) => f.kind === k));
  return {
    blocked: blocking.length > 0,
    kinds,
    count: blocking.length,
    warnings,
    checkedAt: now.toISOString(),
  };
}

/**
 * Lê o relatório gravado em `draftReport.pii`. Tolerante ao legado: modelo
 * ingerido antes deste gate não tem o campo e NÃO é bloqueado por isso —
 * bloquear o que nunca foi medido seria trancar todo acervo existente de uma
 * vez, sem ninguém pedir. A revalidação preenche o campo na primeira leitura.
 */
export function parseTemplatePiiReport(draftReport: unknown): TemplatePiiReport | null {
  const raw = readDraftReport(draftReport).pii;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.blocked !== "boolean") return null;
  // Categoria fora da tabela (relatório de outra versão, JSON editado à mão)
  // não vira "undefined" na tela: é descartada, e `blocked` continua valendo.
  const kinds = Array.isArray(r.kinds) ? r.kinds.filter(isPiiKind) : [];
  const warnings = Array.isArray(r.warnings) ? r.warnings.filter(isPiiKind) : [];
  const count = typeof r.count === "number" && r.count > 0 ? r.count : kinds.length;
  return {
    blocked: r.blocked,
    kinds,
    count: r.blocked ? Math.max(count, 1) : count,
    warnings,
    checkedAt: typeof r.checkedAt === "string" ? r.checkedAt : "",
  };
}

/** Mensagem do 409 `PII_LEFTOVER` — o que o operador lê na tela. */
export function piiGateMessage(report: TemplatePiiReport): string {
  const lista = describePiiKinds(report.kinds);
  const n = Math.max(report.count, 1);
  return (
    `O texto do modelo ainda tem dado pessoal literal (${lista} — ${n} ` +
    `${n === 1 ? "ocorrência" : "ocorrências"}). Todo contrato gerado a partir ` +
    "dele sairia com esse dado. Troque o trecho por uma chave de preenchimento " +
    "ou por uma cláusula do acervo e revalide antes de ativar."
  );
}
