import { prisma } from "@/lib/db/prisma";

/**
 * Falha na geração de um contrato cujo template é `engine="google_docs"`.
 *
 * Nesse engine o corpo do contrato É a cópia do Google Doc da imobiliária — não há
 * fallback Handlebars. Se a cópia (ou a substituição de placeholders) falha, o que
 * sobraria no banco é um Contract com `googleDocId` nulo e um parágrafo de stub como
 * conteúdo: um contrato vazio que parece ter dado certo. Por isso a geração lança em
 * vez de degradar silenciosamente.
 */
export class GoogleDocsGenerationError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "GoogleDocsGenerationError";
  }
}

/**
 * Mensagem em PT-BR, acionável, para a falha do Drive.
 *
 * O 404/403 tem uma causa dominante e não-óbvia: o escopo `drive.file` do OAuth por-org
 * é *por arquivo, por usuário* — só enxerga o que aquela conta criou pelo app. Se a
 * imobiliária trocou a conta Google conectada, os modelos subidos pela conta anterior
 * ficam invisíveis, e a cópia falha.
 */
export function googleDocsFailureMessage(err: unknown, templateName: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const inaccessible = /\b(404|403)\b|not\s*found|permission|insufficient|forbidden/i.test(raw);

  if (inaccessible) {
    return (
      `Não foi possível abrir o modelo "${templateName}" no Google Drive. ` +
      `Isso costuma acontecer quando o modelo foi criado por outra conta Google: ` +
      `reenvie o modelo (.docx) em Modelos › Importar modelo, com a conta que está ` +
      `conectada agora em Configurações › Integrações. (detalhe: ${raw})`
    );
  }
  return `Falha ao gerar o contrato a partir do modelo "${templateName}": ${raw}`;
}

/**
 * Desfaz o Contract recém-criado quando a geração via Google Docs falhou, e devolve o
 * `isLatest` pra versão anterior (o create já tinha rebaixado as antigas). Sem isso o
 * deal ficaria sem nenhuma versão marcada como atual — as telas leem por `isLatest`.
 *
 * Best-effort: se o rollback falhar, quem chama ainda lança o erro original.
 */
export async function rollbackFailedContract(
  contractId: string,
  dealId: string,
  kind: string
): Promise<void> {
  try {
    await prisma.contract.delete({ where: { id: contractId } });
    const previous = await prisma.contract.findFirst({
      where: { dealId, kind },
      orderBy: { version: "desc" },
      select: { id: true },
    });
    if (previous) {
      await prisma.contract.update({
        where: { id: previous.id },
        data: { isLatest: true },
      });
    }
  } catch (rollbackErr) {
    console.error("[contract-generation] Falha ao desfazer contrato órfão:", rollbackErr);
  }
}
