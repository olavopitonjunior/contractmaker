/**
 * Critérios objetivos de medição do OCR.
 *
 * Módulo puro e testável de propósito: é ele que decide qual modelo vai para
 * produção, e uma métrica que só existe dentro do script do bench não pode ser
 * verificada por ninguém.
 *
 * ── A distinção que organiza tudo ────────────────────────────────────────
 *
 * ALUCINAÇÃO e OMISSÃO não são o mesmo erro, e tratá-los como um só número
 * (uma "acurácia" única) esconde a diferença que importa na prática:
 *
 *   - campo VAZIO o corretor percebe e preenche à mão;
 *   - campo PREENCHIDO ERRADO ele assina.
 *
 * Um modelo que erra pouco mas erra "com confiança" é pior, num contrato, que
 * um que deixa em branco. Por isso a taxa de alucinação é critério de REPROVA
 * independente, não uma parcela diluída na acurácia.
 */

/** Campos onde um erro custa caro. Pesam mais na acurácia ponderada. */
const CAMPOS_CRITICOS = new Set([
  "cpf_numero",
  "cnpj",
  "matricula_numero",
  "nome_completo",
  "conjuge_nome",
  "conjuge_cpf",
  "valor_transacao",
  "outorgante_cpf",
  "outorgado_cpf",
]);

const PESO_CRITICO = 3;
const PESO_NORMAL = 1;

/**
 * Normalização canônica antes de comparar. Reproduz o que o formulário faz com
 * o valor — comparar a string crua puniria o modelo por escrever "123.456.789-00"
 * em vez de "12345678900", que é diferença de formatação, não de leitura.
 */
export function normalizarParaComparar(valor: unknown): string {
  if (valor === null || valor === undefined) return "";

  // Estrutura (ficha-resumo devolve `partes[]`/`imoveis[]`) é comparada pelo
  // CONTEÚDO, não por `String(valor)`. Sem isto, dois arrays de objetos
  // completamente diferentes viravam ambos "[object Object]" e o modelo ganhava
  // acerto de graça justamente nos campos mais difíceis.
  if (typeof valor === "object") {
    if (Array.isArray(valor)) {
      return `[${valor.map(normalizarParaComparar).join("|")}]`;
    }
    const obj = valor as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${k}:${normalizarParaComparar(obj[k])}`)
      .join("|")}}`;
  }

  const s = String(valor).trim();
  if (!s) return "";

  // ── Números ──────────────────────────────────────────────────────────
  //
  // Duas famílias que NÃO podem ser tratadas iguais:
  //
  //   quantidade  ("R$ 350.000,00", "350000.00", 350000, "87,45 m²")
  //     → vale o VALOR; ponto e vírgula são separador, não conteúdo.
  //   identificador ("529.982.247-25", "05433-010", "84.512")
  //     → vale a SEQUÊNCIA de dígitos; a pontuação é máscara.
  //
  // Confundir as duas era o achado: `350000` contra um gabarito anotado
  // "R$ 350.000,00" virava ALUCINAÇÃO em `valor_transacao`, que é campo
  // crítico e alimenta o veto do bench.
  const semMoeda = s.replace(/^R\$\s*/i, "").replace(/\s*m²?\s*$/i, "").trim();

  // Decimal BR: vírgula com 1-2 casas. Ponto é separador de milhar.
  const decimalBr = semMoeda.match(/^-?[\d.]+,\d{1,2}$/);
  if (decimalBr) {
    return String(Number(semMoeda.replace(/\./g, "").replace(",", ".")));
  }
  // Decimal US: ponto com 1-2 casas e nenhum outro ponto.
  const decimalUs = semMoeda.match(/^-?\d+\.\d{1,2}$/);
  if (decimalUs) return String(Number(semMoeda));
  // Inteiro puro (inclui o caso de o modelo devolver `number`).
  if (/^-?\d+$/.test(semMoeda)) return String(Number(semMoeda));
  // Data em DD/MM/AAAA colapsa para a MESMA forma que a ISO produz no caminho
  // numérico logo abaixo (AAAAMMDD). Devolver "1980-05-12" aqui não bastaria:
  // a entrada já em ISO cairia no ramo numérico e viraria "19800512", e as duas
  // formas da mesma data nunca bateriam.
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}${br[2]}${br[1]}`;
  // Documento numérico (CPF, CNPJ, CEP, data ISO): só dígitos.
  if (/^[\d.\-/\s]+$/.test(s) && /\d/.test(s)) return s.replace(/\D/g, "");
  return s
    .normalize("NFD")
    // Escapado em vez de literal: combinantes soltos no fonte dependem de o
    // editor preservar bytes, e o repo já usa esta forma (extracted-to-form).
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export interface ResultadoCampo {
  campo: string;
  peso: number;
  /** Bateu com o gabarito. */
  acertou: boolean;
  /**
   * O documento TEM o campo e o modelo devolveu vazio. Erro de recall — o
   * corretor vê o buraco e preenche.
   */
  omitiu: boolean;
  /**
   * O modelo devolveu um valor que NÃO está no documento. O erro caro: entra
   * no contrato parecendo bom.
   */
  alucinou: boolean;
}

export interface PlacarDocumento {
  campos: ResultadoCampo[];
  categoriaCorreta: boolean;
  /** O texto passou por `JSON.parse` (direto ou via regex tolerante). */
  jsonAproveitavel: boolean;
  latenciaMs: number;
  custoUsd: number;
}

/**
 * Compara a saída de um modelo com o gabarito, campo a campo.
 *
 * Só considera os campos que o GABARITO declara. Campo extra que o modelo
 * inventou fora do gabarito não é contado como alucinação aqui — o gabarito é
 * parcial por natureza (ninguém transcreve uma matrícula inteira), e punir o
 * modelo por ler algo que o humano não anotou mediria o esforço do anotador.
 */
export function compararCampos(
  esperado: Record<string, unknown>,
  obtido: Record<string, unknown> | null
): ResultadoCampo[] {
  return Object.entries(esperado).map(([campo, valorEsperado]) => {
    const peso = CAMPOS_CRITICOS.has(campo) ? PESO_CRITICO : PESO_NORMAL;
    const esp = normalizarParaComparar(valorEsperado);
    const got = normalizarParaComparar(obtido?.[campo]);

    // Gabarito vazio = o documento não tem esse campo. Aqui a polaridade
    // inverte: o certo é o modelo NÃO devolver nada, e devolver algo é
    // alucinação pura — o valor não existe no papel.
    if (!esp) {
      return { campo, peso, acertou: !got, omitiu: false, alucinou: !!got };
    }
    if (!got) return { campo, peso, acertou: false, omitiu: true, alucinou: false };
    if (got === esp) return { campo, peso, acertou: true, omitiu: false, alucinou: false };
    return { campo, peso, acertou: false, omitiu: false, alucinou: true };
  });
}

export interface Agregado {
  documentos: number;
  acuraciaPonderada: number;
  taxaAlucinacao: number;
  taxaOmissao: number;
  acertoCategoria: number;
  jsonAproveitavel: number;
  latenciaP50: number;
  latenciaP95: number;
  custoTotalUsd: number;
  custoPorDocUsd: number;
}

function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const ord = [...valores].sort((a, b) => a - b);
  // Nearest-rank. Com poucas amostras (o corpus é de dezenas, não milhares),
  // interpolar inventa um número que nenhuma execução produziu.
  const i = Math.min(ord.length - 1, Math.ceil((p / 100) * ord.length) - 1);
  return ord[Math.max(0, i)];
}

export function agregar(placares: PlacarDocumento[]): Agregado {
  if (placares.length === 0) {
    return {
      documentos: 0,
      acuraciaPonderada: 0,
      taxaAlucinacao: 0,
      taxaOmissao: 0,
      acertoCategoria: 0,
      jsonAproveitavel: 0,
      latenciaP50: 0,
      latenciaP95: 0,
      custoTotalUsd: 0,
      custoPorDocUsd: 0,
    };
  }
  let pesoTotal = 0;
  let pesoAcertado = 0;
  let campos = 0;
  let alucinacoes = 0;
  let omissoes = 0;

  for (const p of placares) {
    for (const c of p.campos) {
      pesoTotal += c.peso;
      if (c.acertou) pesoAcertado += c.peso;
      campos += 1;
      if (c.alucinou) alucinacoes += 1;
      if (c.omitiu) omissoes += 1;
    }
  }

  const lat = placares.map((p) => p.latenciaMs);
  const custo = placares.reduce((s, p) => s + p.custoUsd, 0);

  return {
    documentos: placares.length,
    acuraciaPonderada: pesoTotal > 0 ? pesoAcertado / pesoTotal : 0,
    taxaAlucinacao: campos > 0 ? alucinacoes / campos : 0,
    taxaOmissao: campos > 0 ? omissoes / campos : 0,
    acertoCategoria:
      placares.filter((p) => p.categoriaCorreta).length / placares.length,
    jsonAproveitavel:
      placares.filter((p) => p.jsonAproveitavel).length / placares.length,
    latenciaP50: percentil(lat, 50),
    latenciaP95: percentil(lat, 95),
    custoTotalUsd: custo,
    custoPorDocUsd: custo / placares.length,
  };
}

export interface Veredito {
  aprovado: boolean;
  motivos: string[];
}

/**
 * Critério de aceitação para trocar o modelo de produção.
 *
 * Alucinação é veto: um modelo com acurácia melhor E mais alucinação REPROVA.
 * A razão é a assimetria do começo do arquivo — o campo errado preenchido
 * viaja para o contrato, para a certidão e para a assinatura sem ninguém
 * conferir, enquanto o campo vazio para na primeira leitura humana.
 */
export function avaliar(baseline: Agregado, candidato: Agregado): Veredito {
  const motivos: string[] = [];
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  // Braço vazio NÃO é braço aprovado. `agregar([])` devolve zeros, e zeros
  // passam em todas as comparações abaixo — um modelo cujas chamadas TODAS
  // falharam sairia com "APROVADO". E o espelho é pior: baseline vazio tem
  // alucinação 0 e p95 0, então reprovaria todo candidato contra um baseline
  // que nunca rodou. Nos dois casos a resposta certa é "não medi", não um
  // veredito.
  if (candidato.documentos === 0) {
    return {
      aprovado: false,
      motivos: ["nenhuma chamada foi medida — sem dado, não há veredito"],
    };
  }
  if (baseline.documentos === 0) {
    return {
      aprovado: false,
      motivos: ["o baseline não produziu medição — não há contra o que comparar"],
    };
  }

  if (candidato.taxaAlucinacao > baseline.taxaAlucinacao) {
    motivos.push(
      `alucina mais que o baseline (${pct(candidato.taxaAlucinacao)} vs ` +
        `${pct(baseline.taxaAlucinacao)}) — veto, mesmo com acurácia melhor`
    );
  }
  if (candidato.acuraciaPonderada < baseline.acuraciaPonderada) {
    motivos.push(
      `acurácia ponderada abaixo do baseline (${pct(candidato.acuraciaPonderada)} vs ` +
        `${pct(baseline.acuraciaPonderada)})`
    );
  }
  if (candidato.jsonAproveitavel < baseline.jsonAproveitavel) {
    motivos.push(
      `devolve JSON aproveitável com menos frequência (${pct(candidato.jsonAproveitavel)} ` +
        `vs ${pct(baseline.jsonAproveitavel)})`
    );
  }
  if (candidato.latenciaP95 > baseline.latenciaP95 * 1.5) {
    motivos.push(
      `p95 mais de 50% acima do baseline (${Math.round(candidato.latenciaP95)}ms vs ` +
        `${Math.round(baseline.latenciaP95)}ms) — o worker tem maxDuration e cron de 1 min`
    );
  }
  return { aprovado: motivos.length === 0, motivos };
}
