import { redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, AlertTriangle, ShieldCheck } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { getAccountWithApiKey } from "@/lib/asaas/account";
import {
  getMyAccountDocumentsFull,
  pickActiveOnboardingUrl,
} from "@/lib/asaas/kyc";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Onboarding KYC — Contractmaker",
  robots: { index: false, follow: false },
};

/**
 * Rota pública /kyc/[token] — proxy server-side pro hosted onboarding do
 * Asaas (cadastro.io). Sempre busca a URL fresca de GET /myAccount/documents
 * e redireciona, então a mesma vanity URL funciona indefinidamente (até o
 * admin rotacionar o token).
 *
 * Telas de fallback são server-rendered (sem JS) — funcionam em qualquer
 * navegador, incluindo apps de webview do WhatsApp.
 */
export default async function KycRedirectPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const account = await prisma.asaasAccount.findUnique({
    where: { kycToken: token },
    select: { id: true, status: true, label: true, kyc: true },
  });
  if (!account) {
    return <Wrap><NotFoundCard /></Wrap>;
  }

  // Conta já aprovada — não há ação pra titular fazer
  if (account.status === "APPROVED") {
    const name =
      (account.kyc as { name?: string } | null)?.name ?? account.label ?? null;
    return (
      <Wrap>
        <ApprovedCard name={name} />
      </Wrap>
    );
  }

  let onboardingUrl: string | null = null;
  try {
    const { apiKey } = await getAccountWithApiKey(account.id);
    const docs = await getMyAccountDocumentsFull({ apiKey });
    onboardingUrl = pickActiveOnboardingUrl(docs)?.url ?? null;
  } catch {
    return (
      <Wrap>
        <UnavailableCard />
      </Wrap>
    );
  }

  if (!onboardingUrl) {
    // Sem URL pendente → ou está em análise, ou aprovação manual
    return (
      <Wrap>
        <InAnalysisCard />
      </Wrap>
    );
  }

  // Redirect manda direto pra Asaas — sem render JS, sem flicker
  redirect(onboardingUrl);
}

// ---------- Components (server) ----------

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

function ApprovedCard({ name }: { name: string | null }) {
  return (
    <Card>
      <CardContent className="py-10 text-center space-y-3">
        <CheckCircle2 className="h-12 w-12 mx-auto text-green-600" />
        <h1 className="text-xl font-semibold">Cadastro aprovado ✓</h1>
        <p className="text-sm text-muted-foreground">
          {name
            ? `A conta de ${name} já está aprovada.`
            : "Esta conta já está aprovada."}{" "}
          Nada precisa ser feito aqui.
        </p>
      </CardContent>
    </Card>
  );
}

function InAnalysisCard() {
  return (
    <Card>
      <CardContent className="py-10 text-center space-y-3">
        <ShieldCheck className="h-12 w-12 mx-auto text-blue-600" />
        <h1 className="text-xl font-semibold">Em análise</h1>
        <p className="text-sm text-muted-foreground">
          Os documentos foram enviados e estão sendo revisados pelo Asaas.
          Geralmente leva até 1 dia útil. Você receberá um email quando o
          cadastro for aprovado.
        </p>
      </CardContent>
    </Card>
  );
}

function UnavailableCard() {
  return (
    <Card>
      <CardContent className="py-10 text-center space-y-3">
        <AlertTriangle className="h-12 w-12 mx-auto text-amber-600" />
        <h1 className="text-xl font-semibold">Link indisponível</h1>
        <p className="text-sm text-muted-foreground">
          Não foi possível gerar o link de onboarding no momento. Por favor,
          contate quem te enviou este link para gerar uma nova URL.
        </p>
      </CardContent>
    </Card>
  );
}

function NotFoundCard() {
  return (
    <Card>
      <CardContent className="py-10 text-center space-y-3">
        <AlertTriangle className="h-12 w-12 mx-auto text-red-600" />
        <h1 className="text-xl font-semibold">Link não encontrado</h1>
        <p className="text-sm text-muted-foreground">
          Este link não existe ou foi invalidado. Solicite uma nova URL a quem
          te enviou.
        </p>
      </CardContent>
    </Card>
  );
}
