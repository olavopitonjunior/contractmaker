import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { KycPublicClient } from "./KycPublicClient";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Envio de documentos — Contractmaker",
  robots: { index: false, follow: false },
};

/**
 * Página pública /kyc/[token] — hospedada pelo Contractmaker para o titular
 * da subconta Asaas enviar os documentos de KYC sem precisar do email/painel
 * Asaas. O backend usa a apiKey da subconta (armazenada criptografada) para
 * proxiar os uploads pra Asaas.
 *
 * Sem auth — proteção via token de 64 chars hex (256 bits de entropia).
 */
export default async function KycPublicPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Verifica existência cedo pra evitar render de página vazia.
  const account = await prisma.asaasAccount.findUnique({
    where: { kycToken: token },
    select: { id: true, status: true },
  });
  if (!account) notFound();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <KycPublicClient token={token} />
      </div>
    </div>
  );
}
