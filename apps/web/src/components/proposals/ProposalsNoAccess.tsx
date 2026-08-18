import { ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";

/**
 * Empty-state de permissão da área de propostas. Antes o gate fazia
 * `redirect("/pipeline")` SILENCIOSO — um admin com role fora do catálogo
 * (ex.: o legado "member", que resolve pra zero permissões) via a página
 * "não abrir" sem nenhuma pista do porquê. Server component.
 */
export function ProposalsNoAccess({
  title = "Você não tem permissão para ver propostas",
  description = "Seu papel atual não inclui acesso ao módulo de propostas. Peça a um administrador da organização para ajustar seu papel em Configurações → Equipe.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-16">
      <Card className="flex w-full flex-col items-center gap-3 p-8 text-center">
        <ShieldAlert className="h-10 w-10 text-muted-foreground" aria-hidden />
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </Card>
    </div>
  );
}
