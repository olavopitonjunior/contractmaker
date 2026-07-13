import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";

// Aceita tanto o client global quanto o client de uma transação (tx).
type PrismaLike = Prisma.TransactionClient | typeof prisma;

/**
 * Cria o preset de layout default da org (o "Padrão imobpro", espelho do Zimmermann).
 *
 * Sem uma linha `isDefault=true`, `contract-generation` não acha preset e os Google
 * Docs gerados por Handlebars nascem em Arial 11pt — visualmente errado e sem margens.
 * Templates `engine=google_docs` (.docx da própria imobiliária) não usam o preset, mas
 * quem cria um modelo do zero usa.
 *
 * Idempotente: no-op se a org já tem qualquer DocumentStyle.
 */
export async function seedDefaultDocumentStyle(
  orgId: string,
  client: PrismaLike = prisma
): Promise<{ created: boolean }> {
  const existing = await client.documentStyle.findFirst({
    where: { orgId },
    select: { id: true },
  });
  if (existing) return { created: false };

  await client.documentStyle.create({
    data: {
      orgId,
      name: "Padrão imobpro",
      isDefault: true,
      fontFamily: "EB Garamond",
      fontSizeBase: 11,
      lineHeight: 1.5,
      marginTopMm: 30,
      marginBottomMm: 30,
      marginLeftMm: 30,
      marginRightMm: 30,
      colorPrimary: "#000000",
      colorAccent: "#C97B0A",
      pageNumbers: true,
      includeToc: false,
    },
  });
  return { created: true };
}
