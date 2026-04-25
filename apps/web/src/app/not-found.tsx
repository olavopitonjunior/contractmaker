import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Home, ArrowLeft } from "lucide-react";

export const metadata = {
  title: "Página não encontrada — Contractmaker",
};

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-6">
      <div className="max-w-md w-full text-center space-y-6">
        <div>
          <div className="text-7xl font-bold text-muted-foreground/40">404</div>
          <h1 className="text-2xl font-semibold mt-2">Página não encontrada</h1>
          <p className="text-sm text-muted-foreground mt-2">
            A página que você tentou acessar não existe ou foi movida.
          </p>
        </div>
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/pipeline">
              <ArrowLeft className="h-4 w-4 mr-1" /> Voltar ao pipeline
            </Link>
          </Button>
          <Button asChild>
            <Link href="/financeiro">
              <Home className="h-4 w-4 mr-1" /> Ir para o financeiro
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
