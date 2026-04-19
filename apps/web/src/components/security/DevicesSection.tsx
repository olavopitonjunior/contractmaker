"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Laptop, Smartphone, Trash2, RefreshCw } from "lucide-react";

interface Device {
  id: string;
  label: string | null;
  lastIpAddress: string | null;
  lastSeenAt: string;
  createdAt: string;
}

function detectIcon(label: string | null) {
  if (!label) return <Laptop className="h-4 w-4" />;
  const l = label.toLowerCase();
  if (l.includes("iphone") || l.includes("android") || l.includes("mobile"))
    return <Smartphone className="h-4 w-4" />;
  return <Laptop className="h-4 w-4" />;
}

function fmtRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diffMs / 3_600_000);
  if (h < 1) return "há menos de 1h";
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `há ${d}d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

export function DevicesSection() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/security/devices", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setDevices(data.devices ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function revoke(id: string) {
    if (!confirm("Revogar este dispositivo? Ele exigirá 2FA completo no próximo login."))
      return;
    const res = await fetch(`/api/security/devices/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) {
      toast.success("Dispositivo revogado");
      await load();
    } else {
      toast.error("Falha ao revogar");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span>Dispositivos confiáveis</span>
          <Button variant="ghost" size="icon" onClick={load} title="Atualizar">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && devices.length === 0 && (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        )}
        {!loading && devices.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum dispositivo marcado como confiável. Você pode confiar no dispositivo
            atual durante a próxima confirmação de identidade.
          </p>
        )}
        {devices.map((d) => (
          <div
            key={d.id}
            className="flex items-center justify-between p-2 border rounded"
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {detectIcon(d.label)}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {d.label ?? "Dispositivo sem rótulo"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {d.lastIpAddress && `IP ${d.lastIpAddress} · `}
                  Visto {fmtRelative(d.lastSeenAt)}
                </div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => revoke(d.id)}
              title="Revogar"
            >
              <Trash2 className="h-4 w-4 text-red-600" />
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
