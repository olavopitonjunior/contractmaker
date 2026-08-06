import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import SlaSettingsClient from "./SlaSettingsClient";

export default function SlaSettingsPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link
          href="/settings"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Configurações
        </Link>
        <h1 className="font-display text-2xl font-semibold tracking-tight mt-2">
          SLA do pipeline
        </h1>
        <p className="text-sm text-muted-foreground">
          Prazos por etapa que definem quando um negócio parado entra em
          &ldquo;atenção&rdquo; (badge âmbar) e &ldquo;atrasado&rdquo; (badge
          vermelho) no kanban. Sem personalização, vale o padrão de 5/10 dias.
          Etapas terminais não envelhecem.
        </p>
      </div>
      <SlaSettingsClient />
    </div>
  );
}
