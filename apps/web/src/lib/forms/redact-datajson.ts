/**
 * Redação por leitor do `dataJson` do formulário.
 *
 * Existe uma coisa só aqui: os dados bancários do corretor
 * (`comissao.comissionados[].recebimento` em venda,
 * `comissao.angariadores[].recebimento` em locação).
 *
 * Por que é preciso: até 08/2026 esses campos viviam FORA do `dataJson` de
 * propósito, porque o `GET /api/forms/[token]` devolve o `dataJson` inteiro a
 * qualquer portador do link — que normalmente é o cliente comprador ou
 * locatário — e porque ele alimenta o resumo enviado por e-mail. Produto pediu
 * que ficassem salvos no formulário; a contrapartida inseparável é esta função,
 * aplicada em TODA superfície que devolve o `dataJson` para fora do servidor.
 *
 * As superfícies (a lista viva está em `__tests__/redact-datajson.test.ts`, que
 * falha se alguma delas parar de redigir):
 *
 *  - `GET /api/forms/[token]` e `GET /api/locacao/forms/[token]` — portador do link
 *  - `app/f/[token]/[[...slug]]/page.tsx` — o `initialData` que vai pro browser
 *  - `contract-generation` e o sync do PATCH — o fan-out para
 *    `Contract.dataJson`, de onde LLM, ClickSign e DIMOB leem sem gate de
 *    leitor nenhum (ali é `stripCommissionerReceiving`, sem leitor na história)
 *
 * `GET /api/deals/[dealId]` e `GET /api/pipeline/deals/[dealId]` ficam de FORA
 * de propósito, embora devolvam o dossiê inteiro: os dois exigem autenticação
 * casada com a org dona do negócio (`auth.org.id !== deal.pipeline.orgId` → 403).
 * Quem chega neles JÁ é a imobiliária — redigir ali esconderia da imobiliária um
 * dado que é dela e quebraria a integração M2M da própria casa. O risco que esta
 * função existe para tratar é o portador do LINK, que não se autentica.
 *
 * O subtoken por parte (`/f/p/[subtoken]`) NÃO precisa: `comissao` não existe
 * em `STEP_PATHS` (`participant-visibility.ts`), então é inalcançável por
 * construção, tanto na leitura quanto na escrita.
 *
 * Puro e sem mutação: copia só o caminho tocado. O `dataJson` chega como valor
 * do Prisma e costuma ser reusado no mesmo request (o resumo, o gate, o
 * merge) — mutar in loco faria a redação vazar para quem deve enxergar tudo.
 */

/** Os dois arrays que carregam corretor, um por esteira. */
const ARRAYS_DE_COMISSIONADO = ["comissionados", "angariadores"] as const;

type Dict = Record<string, unknown>;

const isDict = (v: unknown): v is Dict =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Remove os dados bancários do corretor quando o leitor não é da imobiliária.
 *
 * Membro recebe o `dataJson` intacto — é ele quem preenche e quem precisa ver o
 * que já está lá. Devolve o MESMO objeto quando não há nada a redigir, para não
 * clonar o dossiê inteiro a cada request.
 */
export function redactCommissionerReceiving<T>(
  dataJson: T,
  opts: { viewerIsMember: boolean }
): T {
  if (opts.viewerIsMember) return dataJson;
  if (!isDict(dataJson)) return dataJson;

  const comissao = dataJson.comissao;
  if (!isDict(comissao)) return dataJson;

  let mudou = false;
  const novaComissao: Dict = { ...comissao };

  for (const chave of ARRAYS_DE_COMISSIONADO) {
    const lista = comissao[chave];
    if (!Array.isArray(lista)) continue;

    let listaMudou = false;
    const novaLista = lista.map((item) => {
      if (!isDict(item) || !("recebimento" in item)) return item;
      listaMudou = true;
      // `delete` numa cópia, não `recebimento: undefined`: o valor vai virar
      // JSON, e `undefined` some — mas um `null` explícito diria "li e está
      // vazio", que é diferente de "não é da sua conta".
      const copia = { ...item };
      delete copia.recebimento;
      return copia;
    });

    if (listaMudou) {
      novaComissao[chave] = novaLista;
      mudou = true;
    }
  }

  if (!mudou) return dataJson;
  return { ...dataJson, comissao: novaComissao } as T;
}

/**
 * Reinsere o `recebimento` que o leitor não recebeu, a partir do que está
 * gravado, antes de mesclar uma escrita.
 *
 * É a outra metade da redação, e sem ela o conserto vira perda de dado: o
 * `PATCH` do token principal não tem allowlist de propósito
 * (`api/forms/[token]/route.ts`), o autosave do cliente devolve o array de
 * comissionados REDIGIDO, e o merge substituiria o array apagando os dados
 * bancários que a imobiliária tinha preenchido.
 *
 * Casa por `splitRecipientId` quando há, e cai no índice quando não há — que é
 * o mesmo critério que o próprio array usa para se identificar.
 */
export function preserveCommissionerReceiving<T>(
  incoming: T,
  stored: unknown,
  opts: { viewerIsMember: boolean }
): T {
  if (opts.viewerIsMember) return incoming;
  if (!isDict(incoming) || !isDict(stored)) return incoming;

  const comissaoIn = incoming.comissao;
  const comissaoDb = stored.comissao;
  if (!isDict(comissaoIn) || !isDict(comissaoDb)) return incoming;

  let mudou = false;
  const novaComissao: Dict = { ...comissaoIn };

  for (const chave of ARRAYS_DE_COMISSIONADO) {
    const listaIn = comissaoIn[chave];
    const listaDb = comissaoDb[chave];
    if (!Array.isArray(listaIn) || !Array.isArray(listaDb)) continue;

    const porId = new Map<string, unknown>();
    listaDb.forEach((item) => {
      if (isDict(item) && typeof item.splitRecipientId === "string" && item.recebimento) {
        porId.set(item.splitRecipientId, item.recebimento);
      }
    });

    let listaMudou = false;
    const novaLista = listaIn.map((item, i) => {
      // Já veio com dado: não é o caso de restaurar (e sobrescrever seria
      // ignorar o que o autor mandou).
      if (!isDict(item) || item.recebimento) return item;

      const id = typeof item.splitRecipientId === "string" ? item.splitRecipientId : null;
      const anterior =
        (id ? porId.get(id) : undefined) ??
        (isDict(listaDb[i]) ? (listaDb[i] as Dict).recebimento : undefined);
      if (!anterior) return item;

      listaMudou = true;
      return { ...item, recebimento: anterior };
    });

    if (listaMudou) {
      novaComissao[chave] = novaLista;
      mudou = true;
    }
  }

  if (!mudou) return incoming;
  return { ...incoming, comissao: novaComissao } as T;
}

/**
 * Remove os dados bancários do corretor sem que haja "leitor" nenhum na
 * história — usado ao COPIAR o `dataJson` do formulário para o
 * `Contract.dataJson`.
 *
 * Nome próprio porque a decisão é outra: ali não se pergunta quem está lendo,
 * e sim se o dado pertence àquela cópia. Não pertence. O `Contract.dataJson`
 * alimenta o prompt do LLM de análise, o ClickSign e o DIMOB, nenhum dos quais
 * precisa da chave PIX do corretor — e esse caminho não tem gate de leitor.
 */
export function stripCommissionerReceiving<T>(dataJson: T): T {
  return redactCommissionerReceiving(dataJson, { viewerIsMember: false });
}
