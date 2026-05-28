import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default function LocacaoEsteiraPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Esteira — Kanban 6 stages</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Pipeline kind=&quot;locacao&quot; com stages: Análise de Crédito → Aprovação → Confecção de
        Contrato → Em Assinatura → Vistoria de Entrada → Chaves Entregues. Seed via{" "}
        <code>apps/web/scripts/seed-pipeline-locacao.ts</code>. UI final em sincronia com PR #48.
      </CardContent>
    </Card>
  );
}
