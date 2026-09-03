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

async function render(
  input: RenderGoogleDocsPreviewInput
): Promise<GoogleDocsPreviewResult> {
  const { templateId, orgId, docId, modalidade } = input;

  // A revisão do Doc é o que decide se o cache vale: o operador acabou de
  // corrigir uma chave e clica em "Gerar prévia" — o HTML antigo seria mentira.
  let revisionKey = "";
  try {
    const head = await getDocHeadRevision(docId);
    revisionKey = `${head ?? "sem-revisao"}::${SAMPLE_VERSION}`;
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

  // A amostra é o `dataJson` CRU — inclusive com o `recebimento` fictício dos
  // corretores, que na geração de verdade é retirado antes do enrich. Aqui isso
  // é desejável: é o que faz a via de repasse aparecer na cláusula, que é
  // exatamente o que o operador precisa ver antes de ativar o modelo.
  const raw = getPreviewSampleData(modalidade);
  const enriched = enrichLocacaoData(JSON.parse(JSON.stringify(raw)), {});
  const map = buildLocacaoGoogleDocsMap({
    enriched,
    rawDataJson: raw,
    registro: input.registro ?? [],
    // O Perfil REAL da org: é justamente o que o operador precisa conferir —
    // se a conta da imobiliária sai certa na cláusula de corretagem.
    orgRecebimento: input.orgRecebimento ?? null,
    contrato: { numero: "EXEMPLO-0001", id: "exemplo", versao: "1" },
  });

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
