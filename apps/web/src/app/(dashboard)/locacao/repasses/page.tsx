import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default function LocacaoRepassesPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Repasses</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Lente sobre <code>AsaasTransfer</code> com filtro de RentCharge pagas e sem
        repasse. NFS-e por repasse: <code>POST /api/locacao/transfers/[id]/nfse</code>.
      </CardContent>
    </Card>
  );
}
