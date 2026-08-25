/**
 * Shadow mode do OCR — roda um segundo modelo em paralelo, sem que o usuário
 * veja, só para medir divergência em tráfego real.
 *
 * ── Por que existe ────────────────────────────────────────────────────────
 *
 * O bench de visão mede contra um gabarito de dezenas de documentos anotados à
 * mão. É o número mais confiável que temos, e ainda assim é um corpus pequeno e
 * escolhido. O shadow cobre o outro lado: TODO documento que entra, sem
 * gabarito, medindo só se os dois modelos concordam.
 *
 * Os dois respondem perguntas diferentes. O bench diz "quem lê certo"; o shadow
 * diz "onde eles discordam, e com que frequência" — que é o que revela o caso
 * raro que nenhum corpus curado contém.
 *
 * ── O que é gravado, e o que NÃO é ───────────────────────────────────────
 *
 * Só NOME de campo e contagem. Nunca o valor.
 *
 * Gravar o valor extraído seria criar uma segunda cópia de CPF, RG e nome da
 * mãe numa tabela que ninguém trata como sensível, com retenção indefinida e
 * fora de qualquer fluxo de exclusão do titular. Para responder "os modelos
 * divergem, e em quais campos?", o nome do campo basta.
 */

export interface SaidaOcr {
  documentType: string;
  fields: Record<string, unknown>;
}

export interface ComparacaoSombra {
  categoriaPrimaria: string;
  categoriaSombra: string;
  categoriaDivergiu: boolean;
  /** Campos preenchidos pelos dois COM o mesmo valor. */
  camposIguais: number;
  /** Preenchidos pelos dois, com valores DIFERENTES. Só os nomes. */
  camposDivergentes: string[];
  /** Só o primário preencheu — a sombra perderia o dado. */
  camposSoNoPrimario: string[];
  /** Só a sombra preencheu — o primário está perdendo o dado hoje. */
  camposSoNaSombra: string[];
}

/** Vazio, nulo e sentinela de "não li" contam todos como ausência. */
function vazio(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  const s = String(v).trim().toLowerCase();
  return s === "" || s === "null" || s === "n/a" || s === "-";
}

/**
 * Compara valores com a MESMA tolerância do resto do pipeline: diferença de
 * pontuação em CPF, ou de caixa e acento em nome, é formatação — não
 * divergência de leitura. Sem isso o painel acusaria discordância em todo
 * documento e ninguém olharia mais para ele.
 */
function mesmoValor(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => {
    const s = String(v).trim();
    if (/^[\d.\-/\s]+$/.test(s) && /\d/.test(s)) return s.replace(/\D/g, "");
    return s
      .normalize("NFD")
      .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
      .toLowerCase()
      .replace(/\s+/g, " ");
  };
  return norm(a) === norm(b);
}

export function compararSombra(
  primario: SaidaOcr,
  sombra: SaidaOcr
): ComparacaoSombra {
  const chaves = new Set([
    ...Object.keys(primario.fields ?? {}),
    ...Object.keys(sombra.fields ?? {}),
  ]);

  let camposIguais = 0;
  const camposDivergentes: string[] = [];
  const camposSoNoPrimario: string[] = [];
  const camposSoNaSombra: string[] = [];

  for (const k of chaves) {
    const p = primario.fields?.[k];
    const s = sombra.fields?.[k];
    const pVazio = vazio(p);
    const sVazio = vazio(s);
    if (pVazio && sVazio) continue;
    if (pVazio) camposSoNaSombra.push(k);
    else if (sVazio) camposSoNoPrimario.push(k);
    else if (mesmoValor(p, s)) camposIguais += 1;
    else camposDivergentes.push(k);
  }

  return {
    categoriaPrimaria: primario.documentType,
    categoriaSombra: sombra.documentType,
    categoriaDivergiu: primario.documentType !== sombra.documentType,
    camposIguais,
    camposDivergentes: camposDivergentes.sort(),
    camposSoNoPrimario: camposSoNoPrimario.sort(),
    camposSoNaSombra: camposSoNaSombra.sort(),
  };
}

/** Modelo sombra configurado, ou `null` quando o shadow está desligado. */
export function shadowModelFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const m = env.OCR_SHADOW_MODEL?.trim();
  return m ? m : null;
}
