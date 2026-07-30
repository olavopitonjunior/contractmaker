import { prisma } from "@/lib/db/prisma";
import type { DocumentStyleExport } from "./exporter";

/**
 * DocumentStyle padrão da org no shape que o exporter consome.
 *
 * Mesma resolução que `api/contracts/[id]/export` usa pro PDF do contrato —
 * extraída aqui porque as propostas (envio e comprovante de aceite) precisam do
 * mesmo leiaute: sem isso o PDF da proposta saía com margens fixas e sem
 * cabeçalho/rodapé da imobiliária, destoando do contrato que ela mesma assina
 * depois.
 *
 * `null` quando a org não tem preset — o exporter cai no leiaute clássico.
 * Nunca lança: leiaute é cosmético, não pode derrubar um envio.
 */
export async function loadOrgDocumentStyleExport(
  orgId: string
): Promise<DocumentStyleExport | null> {
  try {
    const style = await prisma.documentStyle.findFirst({
      where: { orgId, isDefault: true },
    });
    if (!style) return null;
    return {
      fontFamily: style.fontFamily,
      fontSizeBase: style.fontSizeBase,
      lineHeight: style.lineHeight,
      marginTopMm: style.marginTopMm,
      marginBottomMm: style.marginBottomMm,
      marginLeftMm: style.marginLeftMm,
      marginRightMm: style.marginRightMm,
      colorPrimary: style.colorPrimary,
      headerHtml: style.headerHtml,
      footerHtml: style.footerHtml,
      pageNumbers: style.pageNumbers,
    };
  } catch (err) {
    console.warn("[document-style] falha ao carregar preset da org:", err);
    return null;
  }
}
