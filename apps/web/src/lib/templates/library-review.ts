/**
 * Estado de TODA a biblioteca de modelos de uma org, num levantamento só.
 *
 * Por que existe: a revisão era modelo a modelo. Para saber se a biblioteca
 * está pronta, o operador teria de abrir 16 telas e lembrar do que viu em cada
 * uma — foi assim que os 16 modelos da RE/MAX Trio chegaram a "prontos" com 10
 * erros semânticos, e foi assim que, depois de corrigidos à mão, 16 de 16
 * seguiram com a lista de rateio chaveada item a item sem ninguém notar. O que
 * falta não é detalhe de cada modelo: é a visão de conjunto.
 *
 * DELEGA a `validateGoogleDocTemplate`, e isso é a decisão central do módulo. A
 * alternativa — reimplementar as contagens aqui, mais rápida de escrever —
 * criaria uma segunda fonte de verdade sobre "dá para ativar?": o painel diria
 * uma coisa, a tela do modelo diria outra, e o operador não teria como saber em
 * qual acreditar. Regra nova entra num lugar só.
 *
 * Consequência aceita: cada linha GRAVA o `draftReport` do seu modelo, porque a
 * validação individual grava. É o comportamento certo — o relatório é espelho
 * do Doc (é o que faz o conserto manual valer sem passo extra, e o que rebaixa
 * `applied` de true para false quando o token sumiu). Um painel que medisse sem
 * carimbar deixaria a tela do modelo mostrando um estado que ele mesmo acabou
 * de saber ser velho.
 */
import { prisma } from "@/lib/db/prisma";
import { persistableSemanticReport, type SemanticFinding } from "./semantic-checks";
import { validateGoogleDocTemplate, type ValidatableTemplate } from "./validate-gdoc";

export interface LibraryReviewRow {
  templateId: string;
  name: string;
  modalidade: string | null;
  status: string;
  /** Chaves do catálogo da modalidade presentes / total. */
  chaves: { presentes: number; total: number };
  /** Chaves obrigatórias que faltam — cada uma é uma trava de ativação. */
  faltamObrigatorias: string[];
  /** Chaves no Doc fora do catálogo: ninguém as preenche na geração. */
  desconhecidas: string[];
  /** Dado pessoal literal bloqueando a ativação. */
  piiBloqueia: boolean;
  /**
   * Achados semânticos na forma PERSISTÍVEL (excerto mascarado, conserto
   * reduzido ao verbo). O painel lista e conserta por `findingId`, e a rota de
   * edição resolve a frase no servidor — trecho cru de contrato não precisa
   * trafegar para desenhar uma lista.
   */
  achados: SemanticFinding[];
  /** Quantos achados têm conserto automático (os outros pedem a mão). */
  consertaveis: number;
  /** O Doc não pôde ser lido — a linha diz isso em vez de fingir estado. */
  erro?: string;
  /** Sem obrigatória faltando, sem PII bloqueante e sem erro semântico. */
  pronto: boolean;
}

export interface LibraryReviewResult {
  rows: LibraryReviewRow[];
  checkedAt: string;
  /** Havia mais modelos que o teto — a lista está truncada. */
  truncado: boolean;
}

/** Leituras do Drive em paralelo. Teto baixo: a cota é da org, não da tela. */
const CONCURRENCY = 4;

type ModeloRow = ValidatableTemplate & { name: string; status: string };

/**
 * Levanta o estado de todos os modelos `google_docs` da org.
 *
 * Modelo arquivado fica de fora: não gera contrato e só encheria a lista do que
 * o operador precisa decidir. Modelo ATIVO fica DENTRO de propósito — é
 * exatamente onde um erro custa caro, e o painel é o único lugar que voltaria a
 * olhar para ele depois da ativação.
 */
export async function reviewLibrary(input: {
  orgId: string;
  /** Teto de segurança: cada linha custa uma leitura do Drive. */
  max?: number;
}): Promise<LibraryReviewResult> {
  const { orgId, max = 60 } = input;

  const modelos = await prisma.contractTemplate.findMany({
    where: {
      orgId,
      engine: "google_docs",
      googleTemplateDocId: { not: null },
      status: { not: "archived" },
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    take: max + 1,
    select: {
      id: true,
      orgId: true,
      name: true,
      engine: true,
      modalidade: true,
      status: true,
      googleTemplateDocId: true,
      handlebarsSource: true,
      sourceHash: true,
      draftReport: true,
    },
  });
  const truncado = modelos.length > max;
  const alvo: ModeloRow[] = (truncado ? modelos.slice(0, max) : modelos) as ModeloRow[];

  const rows: LibraryReviewRow[] = new Array(alvo.length);
  let proximo = 0;
  async function worker() {
    for (;;) {
      const i = proximo++;
      if (i >= alvo.length) return;
      rows[i] = await revisarUm(alvo[i]!, orgId);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, alvo.length) }, worker));

  return { rows, checkedAt: new Date().toISOString(), truncado };
}

async function revisarUm(m: ModeloRow, orgId: string): Promise<LibraryReviewRow> {
  const base = {
    templateId: m.id,
    name: m.name,
    modalidade: m.modalidade,
    status: m.status,
    chaves: { presentes: 0, total: 0 },
    faltamObrigatorias: [] as string[],
    desconhecidas: [] as string[],
    piiBloqueia: false,
    achados: [] as SemanticFinding[],
    consertaveis: 0,
    pronto: false,
  };

  let v: Awaited<ReturnType<typeof validateGoogleDocTemplate>>;
  try {
    v = await validateGoogleDocTemplate({ template: m, orgId });
  } catch (err) {
    // Doc apagado do Drive é o caso REAL mais comum aqui (um modelo da staging
    // tinha o Doc removido, e o 502 parecia defeito de código). A linha diz
    // isso; fingir "nenhum problema" seria a pior saída possível.
    return { ...base, erro: err instanceof Error ? err.message : String(err) };
  }

  const achados = persistableSemanticReport(v.semantic).findings;
  const erros = achados.filter((f) => f.severity === "error");
  return {
    ...base,
    chaves: { presentes: v.catalog.filter((c) => c.present).length, total: v.catalog.length },
    faltamObrigatorias: v.missingRequired,
    desconhecidas: v.unknown,
    piiBloqueia: v.pii?.blocked ?? false,
    achados,
    consertaveis: v.semantic.findings.filter(
      (f) => f.suggestedFix && f.suggestedFix.op !== "manual"
    ).length,
    pronto: v.missingRequired.length === 0 && !(v.pii?.blocked ?? false) && erros.length === 0,
  };
}
