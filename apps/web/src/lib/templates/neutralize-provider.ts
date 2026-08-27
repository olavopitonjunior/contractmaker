/**
 * Neutraliza NOMES DE FORNECEDOR no corpo do Google Doc do template.
 *
 * A regra de produto diz que o template é neutro de fornecedor: quem nomeia a
 * seguradora/garantidora é a cláusula do acervo, eleita na geração. O slot cuida
 * do trecho principal — mas contratos reais citam o fornecedor em OUTROS
 * lugares (na Ativa: a cláusula de pintura interna nomeia a Porto Seguro), e
 * até aqui isso era só um aviso `provider_in_template` que deixava o template
 * inativável e cobrava edição manual do Doc — em todo tenant, para sempre.
 *
 * Este passo é determinístico e roda DEPOIS do slot (o trecho da garantia já
 * saiu do corpo; o que sobrou de menção é, por construção, fora do slot) e
 * ANTES do pass de IA de placeholders:
 *
 * - só substitui NOMES CONHECIDOS, vindos do plano (rótulos das cláusulas de
 *   fornecedor) e da classificação dos itens — nunca heurística de "parece nome
 *   de seguradora";
 * - substitui do nome mais longo para o mais curto ("Tokio Marine Seguradora
 *   S.A." antes de "Tokio Marine"), sem diferenciar caixa;
 * - RELÊ o documento e confere: menção que sobrou (grafia que não conhecemos)
 *   vai para `leftover`, e o chamador mantém o comportamento antigo — issue e
 *   template inativável. Neutralizar é melhoria; afirmar neutralidade sem
 *   conferir seria o mesmo defeito da trava 3 do apply-clause-slot.
 *
 * O termo substituto não carrega artigo ("seguradora contratada", não "a
 * seguradora contratada"): o nome aparece em contextos como "junto a X" e
 * "pela X", e o artigo duplicaria. O texto resultante é legível, não perfeito —
 * o template segue draft e o operador revisa antes de ativar.
 */

import { batchUpdateDoc, getDocPlainText } from "@/lib/google/docs";

/** Nome mais curto que isto casa demais para valer o risco de substituição. */
export const MIN_PROVIDER_NAME_CHARS = 5;

/** Termo neutro por tipo de garantia; fora do mapa, o genérico. */
const REPLACEMENT_BY_GARANTIA: Record<string, string> = {
  seguro_fianca: "seguradora contratada",
  titulo_capitalizacao: "instituição emissora do título",
  garantia_onerosa: "garantidora contratada",
};

export function neutralReplacementFor(garantiaTipo: string | null | undefined): string {
  return REPLACEMENT_BY_GARANTIA[garantiaTipo ?? ""] ?? "fornecedora da garantia";
}

export interface NeutralizeProvidersInput {
  docId: string;
  /** Rótulos humanos dos fornecedores conhecidos ("Porto Seguro", …). */
  providers: readonly string[];
  /** Termo neutro que entra no lugar — ver {@link neutralReplacementFor}. */
  replacement: string;
}

export interface NeutralizeProvidersReport {
  /** Substituições efetivadas, por nome. */
  replaced: Array<{ provider: string; occurrences: number }>;
  /** Nomes ainda presentes na releitura — o template segue não-neutro. */
  leftover: string[];
  /** true quando não havia nada a fazer (nenhum nome no corpo). */
  clean: boolean;
}

function normalizeNames(providers: readonly string[]): string[] {
  const names = Array.from(
    new Set(
      providers
        .map((p) => (p ?? "").replace(/\s+/g, " ").trim())
        .filter((p) => p.length >= MIN_PROVIDER_NAME_CHARS)
    )
  );
  // Mais longo primeiro: "Tokio Marine Seguradora S.A." antes de "Tokio
  // Marine", senão a forma curta come o miolo da longa e deixa restos.
  return names.sort((a, b) => b.length - a.length);
}

function containsCi(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function countCi(haystack: string, needle: string): number {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  let count = 0;
  let idx = h.indexOf(n);
  while (idx !== -1) {
    count++;
    idx = h.indexOf(n, idx + n.length);
  }
  return count;
}

export async function neutralizeProvidersInDoc(
  input: NeutralizeProvidersInput
): Promise<NeutralizeProvidersReport> {
  const names = normalizeNames(input.providers);
  const none: NeutralizeProvidersReport = { replaced: [], leftover: [], clean: true };
  if (names.length === 0) return none;

  let docText: string;
  try {
    docText = await getDocPlainText(input.docId);
  } catch (err) {
    console.error("[neutralize-provider] não consegui ler o doc:", err);
    // Não sabemos o estado — reportar TODOS como leftover é o fail-closed:
    // quem chama mantém o aviso e o template inativável.
    return { replaced: [], leftover: [...names], clean: false };
  }

  const present = names.filter((n) => containsCi(docText, n));
  if (present.length === 0) return none;

  try {
    await batchUpdateDoc(
      input.docId,
      present.map((text) => ({
        replaceAllText: {
          containsText: { text, matchCase: false },
          replaceText: input.replacement,
        },
      }))
    );
  } catch (err) {
    console.error("[neutralize-provider] batchUpdate falhou:", err);
    return { replaced: [], leftover: present, clean: false };
  }

  // Conferir o resultado, não presumi-lo (a mesma disciplina do slot).
  let finalText: string;
  try {
    finalText = await getDocPlainText(input.docId);
  } catch (err) {
    console.error("[neutralize-provider] não consegui reler o doc:", err);
    return { replaced: [], leftover: present, clean: false };
  }

  const leftover = names.filter((n) => containsCi(finalText, n));
  return {
    replaced: present
      .filter((n) => !leftover.includes(n))
      .map((provider) => ({ provider, occurrences: countCi(docText, provider) })),
    leftover,
    clean: leftover.length === 0,
  };
}
