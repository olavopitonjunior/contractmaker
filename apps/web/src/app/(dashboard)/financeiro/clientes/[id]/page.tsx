import { CustomerDetail } from "@/components/financeiro/CustomerDetail";

export const metadata = { title: "Detalhe do cliente" };
export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CustomerDetail customerId={id} />;
}
