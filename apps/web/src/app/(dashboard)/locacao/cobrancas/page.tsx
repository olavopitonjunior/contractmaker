import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default function LocacaoCobrancasPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cobranças</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Esta tela é uma <strong>lente</strong> sobre <code>/financeiro/cobrancas</code> filtrando{" "}
        <code>CommissionCharge.kind=&quot;aluguel&quot;</code>. Dados crus em{" "}
        <code>GET /api/locacao/rent-charges</code>.
      </CardContent>
    </Card>
  );
}
