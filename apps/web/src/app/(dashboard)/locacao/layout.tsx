import Link from "next/link";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Workspace de Locação — sub-nav contextual (D4). Não duplica /financeiro.
// docs/locacao/spec.md §14.2.

const SUB_NAV = [
  { label: "Dashboard", href: "/locacao" },
  { label: "Imóveis", href: "/locacao/imoveis" },
  { label: "Esteira", href: "/locacao/esteira" },
  { label: "Contratos ativos", href: "/locacao/contratos" },
  { label: "Cobranças", href: "/locacao/cobrancas" },
  { label: "Repasses", href: "/locacao/repasses" },
  { label: "Despesas", href: "/locacao/despesas" },
  { label: "Vistorias", href: "/locacao/vistorias" },
  { label: "Newton", href: "/locacao/newton" },
];

export default function LocacaoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <Tabs defaultValue="/locacao" className="w-full">
        <TabsList className="overflow-x-auto whitespace-nowrap">
          {SUB_NAV.map((item) => (
            <TabsTrigger key={item.href} value={item.href} asChild>
              <Link href={item.href}>{item.label}</Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="min-h-[60vh]">{children}</div>
    </div>
  );
}
