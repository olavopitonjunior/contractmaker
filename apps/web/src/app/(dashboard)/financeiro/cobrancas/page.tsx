import { ChargesList } from "@/components/financeiro/ChargesList";

export const metadata = { title: "Cobranças" };
export const dynamic = "force-dynamic";

export default function CobrancasPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Cobranças</h1>
        <p className="text-sm text-muted-foreground">
          Todas as cobranças da organização — PIX, boleto e avulsas.
        </p>
      </div>
      <ChargesList />
    </div>
  );
}
