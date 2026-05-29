import { LocacaoSubNav } from "@/components/locacao/LocacaoSubNav";

// Workspace de Locação — sub-nav contextual (D4). Não duplica /financeiro.
// docs/locacao/spec.md §14.2.

export default function LocacaoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 px-2 py-2 sm:p-4">
      <LocacaoSubNav />
      <div className="min-h-[60vh]">{children}</div>
    </div>
  );
}
