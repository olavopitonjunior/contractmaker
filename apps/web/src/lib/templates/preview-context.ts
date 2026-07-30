import { renderContratoHTML } from "@/lib/render/handlebars";
import { enrichContractData } from "@/lib/services/contract-generation";
import { enrichLocacaoData, enrichAdministracaoData } from "@/lib/locacao/enrich";
import { buildViaContext } from "@/lib/proposals/render";
import { stripActiveContent } from "@/lib/proposals/preview-html";
import {
  templateFamilyForModalidade,
  schemaTypeForModalidade,
  previewFixturesForModalidade,
  ADMINISTRACAO_LOCACAO_MODALIDADE,
} from "@/lib/contracts/template-category";
import { getPreviewSampleData } from "./preview-sample-data";

/**
 * Preview de template Handlebars — HTML renderizado com dados de exemplo,
 * pronto pro `srcDoc` de um `<iframe sandbox>`.
 *
 * NÃO passa pelo Google. O preview subia o HTML renderizado pro Drive
 * (`uploadHtmlAsGoogleDoc`) só pra ter uma URL de iframe; com o refresh token da
 * org expirado — o que acontece toda semana em staging, projeto OAuth em modo
 * "Testing" — o upload lançava `invalid_grant` e a tela inteira morria com o
 * documento já renderizado em memória. O Google Doc segue sendo usado onde é a
 * FONTE do texto (engine `google_docs`), nunca como visualizador.
 */

/**
 * O fixture pedido pela UI, validado contra as amostras que a modalidade do
 * template aceita. Body de request não é fonte de verdade: pedir `a_vista` num
 * template de proposta renderizaria o schema errado (documento em branco).
 */
export function resolvePreviewFixture(
  modalidade: string | null | undefined,
  requested: unknown
): string {
  const fixtures = previewFixturesForModalidade(modalidade);
  const match =
    typeof requested === "string" ? fixtures.find((f) => f.value === requested) : undefined;
  return (match ?? fixtures[0]).value;
}

/**
 * Contexto de render por FAMÍLIA do template. Cada esteira tem o seu enrich —
 * usar o de venda numa proposta de aluguel injeta multas/prazos de compra e
 * venda e materializa `comissao` do nada (ver `lib/proposals/render.ts`).
 *
 * `administracao_locacao` é locação apesar de a modalidade não começar com
 * "locacao" (o nome é deliberado, pra ficar fora do fallback `startsWith` de
 * `selectLocacaoTemplate`) — a família resolve isso e o preview passa a receber
 * `locadores`/`imovel` em vez da amostra de venda.
 */
export function buildTemplatePreviewContext(
  modalidade: string | null | undefined,
  fixture: string
): Record<string, unknown> {
  const sample = getPreviewSampleData(fixture);
  const family = templateFamilyForModalidade(modalidade);

  if (family === "proposta") {
    // A proposta não é só enrich: `numero_proposta`, `via_reduzida` e
    // `comissao_incluida` são postos por `buildViaContext` e os templates
    // `proposta_*.hbs` testam os três. Preview é sempre a via COMPLETA.
    return buildViaContext({
      schemaType: schemaTypeForModalidade(modalidade),
      dataJson: sample,
      hiddenPaths: [],
      via: "completa",
      numero: "0001",
      comissaoIncluida: true,
    });
  }

  if (family === "locacao") {
    // O contrato de administração tem cláusulas próprias (taxa de admin,
    // repasse, exclusividade) que só `enrichAdministracaoData` materializa —
    // é o mesmo enrich que a geração real usa.
    return modalidade === ADMINISTRACAO_LOCACAO_MODALIDADE
      ? enrichAdministracaoData(sample)
      : enrichLocacaoData(sample);
  }

  return enrichContractData(sample);
}

/**
 * HTML final do preview: já sanitizado, pronto pro `srcDoc`.
 *
 * `renderContratoHTML` compila com `noEscape` (os templates trazem HTML de
 * layout), então valores da amostra entram crus — `stripActiveContent` é a
 * primeira das duas camadas; a segunda é o `<iframe sandbox="">` sem
 * `allow-scripts` nem `allow-same-origin` no componente.
 */
export function buildTemplatePreviewHtml(input: {
  handlebarsSource: string;
  modalidade: string | null | undefined;
  fixture: string;
}): string {
  const ctx = buildTemplatePreviewContext(input.modalidade, input.fixture);
  return stripActiveContent(renderContratoHTML(input.handlebarsSource, ctx));
}
