// Workspace de Locação. A navegação entre as superfícies agora mora na sidebar
// principal (grupo "ADM Locação"); a antiga sub-nav horizontal foi removida pra
// não duplicar navegação. docs/locacao/spec.md §14.2.

export default function LocacaoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 px-2 py-2 sm:p-4">
      <div className="min-h-[60vh]">{children}</div>
    </div>
  );
}
