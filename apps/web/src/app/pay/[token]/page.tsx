import { notFound } from "next/navigation";
import { PublicChargeView } from "@/components/public/PublicChargeView";
import { resolvePublicToken } from "@/lib/financeiro/publicPage";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const link = await resolvePublicToken(token);
  if (!link) return { title: "Cobrança não encontrada" };
  const brand = link.brandSnapshot as any;
  const displayName = brand?.displayName ?? "Pagamento";
  return {
    title: `Cobrança · ${displayName}`,
    robots: { index: false, follow: false, noarchive: true },
    other: {
      "og:title": `Pagamento via ${displayName}`,
      "og:description": `Pague sua cobrança de forma segura via ${displayName}`,
    },
  };
}

export default async function PublicPayPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const link = await resolvePublicToken(token);
  if (!link) notFound();
  if (link.charge.status === "CANCELLED") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-muted">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-2xl font-semibold">Esta cobrança foi cancelada</h1>
          <p className="text-sm text-muted-foreground">
            Entre em contato com a imobiliária para mais informações.
          </p>
        </div>
      </div>
    );
  }
  return <PublicChargeView initialToken={token} />;
}
