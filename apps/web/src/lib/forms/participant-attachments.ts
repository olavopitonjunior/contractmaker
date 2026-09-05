import { prisma } from "@/lib/db/prisma";

/**
 * Documento que já está atribuído a uma parte passa a pertencer ao LINK
 * daquela parte, quando o link nasce.
 *
 * O `FormAttachment.participantId` é o eixo da visão por parte: o GET de
 * anexos por subtoken filtra por ele, então anexo com `participantId: null`
 * (upload do admin, e os que a conversão de proposta copia) é invisível para
 * quem entra pelo link próprio. Resultado: o locatário abria o link e via
 * "nenhum documento", com o RG dele já anexado do outro lado — e reenviava.
 *
 * O casamento é EXATO por `extractedData.assignment.{kind,index}` == papel e
 * índice do participante. Sem casamento, nada muda: o anexo continua null e
 * segue visível só para o membro da org. Nunca move anexo já reivindicado por
 * outro participante (`participantId: null` no where) — atribuir errado
 * vazaria documento entre partes.
 */
export async function claimParticipantAttachments(
  formId: string,
  participants: ReadonlyArray<{ id: string; role: string; partyIndex: number }>
): Promise<number> {
  let claimed = 0;
  for (const p of participants) {
    const r = await prisma.formAttachment.updateMany({
      where: {
        formId,
        participantId: null,
        AND: [
          { extractedData: { path: ["assignment", "kind"], equals: p.role } },
          { extractedData: { path: ["assignment", "index"], equals: p.partyIndex } },
        ],
      },
      data: { participantId: p.id },
    });
    claimed += r.count;
  }
  return claimed;
}
