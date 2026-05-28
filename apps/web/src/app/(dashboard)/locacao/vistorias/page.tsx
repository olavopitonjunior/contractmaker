import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default function LocacaoVistoriasPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Vistorias</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Listagem e agendamento de vistorias (entrada/saída/contra). PWA do
        vistoriador em <code>/vistoria/[os]</code>. Endpoint:{" "}
        <code>POST /api/locacao/inspections</code>.
      </CardContent>
    </Card>
  );
}
