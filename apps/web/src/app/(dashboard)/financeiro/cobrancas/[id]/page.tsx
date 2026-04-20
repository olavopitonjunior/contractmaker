import { ChargeDetail } from "@/components/financeiro/ChargeDetail";

export const metadata = { title: "Detalhe da cobrança — Contractmaker" };
export const dynamic = "force-dynamic";

export default async function ChargeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ChargeDetail chargeId={id} />;
}
