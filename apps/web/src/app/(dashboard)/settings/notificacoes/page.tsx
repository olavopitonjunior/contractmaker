import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import NotificationSettingsClient from "./NotificationSettingsClient";

export default function NotificationSettingsPage() {
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
          Notificações do processo
        </h1>
        <p className="text-sm text-muted-foreground">
          Padrão da imobiliária para as atualizações automáticas enviadas aos
          corretores envolvidos em cada negócio. Cada venda pode sobrescrever
          este padrão na aba Notificações do negócio, e cada corretor tem as
          próprias preferências de canal na tela Corretores.
        </p>
      </div>
      <NotificationSettingsClient />
    </div>
  );
}
