/**
 * Prévia de um modelo Google Docs COM DADOS DE EXEMPLO.
 *
 * Por que existe: para modelo `google_docs`, a prévia mostrava o próprio
 * Doc-modelo — isto é, `{{chaves}}` cruas. O operador via o relatório de
 * validação e o documento com chaves, e nunca via **como o contrato sai**. Foi
 * decidindo no escuro que os 16 modelos da RE/MAX Trio foram aprovados com 10
 * erros semânticos: nenhum deles seria aprovado por quem tivesse visto a
 * cláusula preenchida.
 *
 * O que ela faz: copia o Doc-modelo, preenche com a amostra fictícia pelo MESMO
 * mapa da geração (`gdoc-replacement-map.ts` — se fosse um mapa próprio, a
 * prévia mentiria assim que os dois divergissem), exporta HTML e **manda a
 * cópia para a lixeira**. A cópia é descartável de propósito: um Doc de prévia
 * sobrevivente viraria lixo no Drive da imobiliária e, pior, um documento com
 * cara de contrato que ninguém sabe de onde veio.
 *
 * Custo: uma cópia + um export por chamada, alguns segundos. Por isso há cache
 * por revisão do Doc e um mutex em memória — dois cliques seguidos no botão não
 * geram duas cópias.
 */
import { getDocHeadRevision, exportDocAsHtml, cleanupOrphanPlaceholders } from "@/lib/google/docs";
import { copyContractGoogleDoc } from "@/lib/google/copy-doc";
import { trashDriveFile } from "@/lib/google/org-oauth";
import { replacePlaceholdersInDoc } from "@/lib/google/replace-placeholders";
import { enrichLocacaoData } from "@/lib/locacao/enrich";
import { templateFamilyForModalidade } from "@/lib/contracts/template-category";
import { textFingerprint } from "@/lib/ingestion/pii";
import { buildLocacaoGoogleDocsMap } from "./gdoc-replacement-map";
import { getPreviewSampleData } from "./preview-sample-data";
import type { RecebimentoData } from "@/lib/forms/commissioner-receiving";
import type { RegistroCorretor } from "./corretagem";

export interface GoogleDocsPreviewResult {
  html: string;
  /** Identidade do que foi renderizado: revisão do Doc + versão da amostra. */
  revisionKey: string;
  cached: boolean;
}

export interface RenderGoogleDocsPreviewInput {
  templateId: string;
  orgId: string;
  docId: string;
  modalidade: string;
  /** Cadastro de corretores da org, se houver — a prévia usa fictício quando não. */
  registro?: RegistroCorretor[];
  /** Onde a imobiliária recebe (Perfil da org) — mostra o dado REAL da org. */
  orgRecebimento?: RecebimentoData | null;
}

/** Versão da amostra: muda quando os fixtures mudam, invalidando o cache. */
const SAMPLE_VERSION = "2026-09-03";

/**
 * Uma prévia por modelo de cada vez. Sem isto, dois cliques no botão geram duas
 * cópias no Drive e a segunda pode terminar depois da primeira, devolvendo o
 * HTML da corrida perdida.
 */
const emVoo = new Map<string, Promise<GoogleDocsPreviewResult>>();
/** Cache em processo: chave de revisão → HTML. */
const cache = new Map<string, { revisionKey: string; html: string }>();

export async function renderGoogleDocsPreview(
  input: RenderGoogleDocsPreviewInput
): Promise<GoogleDocsPreviewResult> {
  const emAndamento = emVoo.get(input.templateId);
  if (emAndamento) return emAndamento;

  const promessa = render(input).finally(() => emVoo.delete(input.templateId));
  emVoo.set(input.templateId, promessa);
  return promessa;
}

/** A família do modelo não tem construtor de mapa — não há prévia honesta. */
export class PreviewFamiliaNaoSuportadaError extends Error {
  constructor(readonly familia: string) {
    super(
      "Ainda não sei montar uma prévia preenchida para esta família de modelo. " +
        "Use o documento ao lado para conferir as chaves."
    );
    this.name = "PreviewFamiliaNaoSuportadaError";
  }
}

/**
 * O mapa da FAMÍLIA do modelo — não sempre o de locação.
 *
 * A geração despacha por família (`buildVendaPlaceholderMap` para venda), e a
 * ingestão aceita `google_docs` em venda e proposta. Uma prévia que rodasse o
 * mapa de locação sobre dados de venda não daria erro: daria um mapa quase
 * vazio, e `cleanupOrphanPlaceholders` apagaria em silêncio as chaves que o
 * modelo tem — entregando ao operador uma prévia limpa e ERRADA. Que é
 * exatamente o defeito que esta tela existe para não repetir.
 *
 * `proposta` não tem construtor em lugar nenhum do código: recusa explícita, em
 * vez de prévia inventada.
 */
async function montarMapa(
  input: RenderGoogleDocsPreviewInput
): Promise<Record<string, string>> {
  const familia = templateFamilyForModalidade(input.modalidade);
  // A amostra é o `dataJson` CRU — inclusive com o `recebimento` fictício dos
  // corretores, que na geração de verdade é retirado antes do enrich. Aqui isso
  // é desejável: é o que faz a via de repasse aparecer na cláusula, que é
  // exatamente o que o operador precisa ver antes de ativar o modelo.
  const raw = getPreviewSampleData(input.modalidade);
  const clone = () => JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;

  if (familia === "locacao") {
    return buildLocacaoGoogleDocsMap({
      enriched: enrichLocacaoData(clone(), {}),
      rawDataJson: raw,
      registro: input.registro ?? [],
      // O Perfil REAL da org: é justamente o que o operador precisa conferir —
      // se a conta da imobiliária sai certa na cláusula de corretagem.
      orgRecebimento: input.orgRecebimento ?? null,
      contrato: { numero: "EXEMPLO-0001", id: "exemplo", versao: "1" },
    });
  }

  if (familia === "venda") {
    const { enrichContractData } = await import("@/lib/services/contract-generation");
    const { buildVendaPlaceholderMap } = await import("./placeholder-map");
    const map = buildVendaPlaceholderMap(
      enrichContractData(clone() as never) as unknown as Record<string, unknown>
    );
    map.contrato_numero = "EXEMPLO-0001";
    map.contrato_id = "exemplo";
    map.contrato_versao = "1";
    return map;
  }

  throw new PreviewFamiliaNaoSuportadaError(familia);
}

async function render(
  input: RenderGoogleDocsPreviewInput
): Promise<GoogleDocsPreviewResult> {
  const { templateId, orgId, docId, modalidade } = input;

  // A revisão do Doc é o que decide se o cache vale: o operador acabou de
  // corrigir uma chave e clica em "Gerar prévia" — o HTML antigo seria mentira.
  let revisionKey = "";
  try {
    const head = await getDocHeadRevision(docId);
    // O Perfil da org entra na chave: ele é IMPRESSO na prévia (a conta onde a
    // imobiliária recebe), e o operador que acabou de corrigir a conta em
    // /settings/perfil e volta para conferir receberia o HTML anterior — a
    // staleness exata que a feature existe para evitar, só que na outra ponta.
    const orgKey = textFingerprint(JSON.stringify(input.orgRecebimento ?? null));
    revisionKey = `${head ?? "sem-revisao"}::${SAMPLE_VERSION}::${orgKey}`;
  } catch {
    // Sem a revisão, não há como saber se o cache serve: renderiza de novo.
    revisionKey = "";
  }
  if (revisionKey) {
    const guardado = cache.get(templateId);
    if (guardado?.revisionKey === revisionKey) {
      return { html: guardado.html, revisionKey, cached: true };
    }
  }

  const map = await montarMapa(input);

  let copiaId: string | null = null;
  try {
    const copia = await copyContractGoogleDoc({
      sourceDocId: docId,
      name: `[PRÉVIA] ${templateId}`,
      orgId,
    });
    copiaId = copia.docId;
    await replacePlaceholdersInDoc({ docId: copiaId, replacements: map });
    // Chave que o modelo tem e o mapa não: sai do documento em vez de aparecer
    // crua na prévia — o mesmo tratamento da geração.
    await cleanupOrphanPlaceholders(copiaId);
    const html = await exportDocAsHtml(copiaId);
    if (revisionKey) cache.set(templateId, { revisionKey, html });
    return { html, revisionKey, cached: false };
  } finally {
    // SEMPRE, inclusive quando o export falhou: a cópia não tem outro dono, e
    // um Doc com cara de contrato sobrando no Drive da imobiliária é pior que
    // uma prévia que falhou.
    if (copiaId) {
      try {
        await trashDriveFile(copiaId, orgId);
      } catch (err) {
        console.error("[gdoc-preview] não consegui descartar a cópia da prévia:", err);
      }
    }
  }
}
