"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";

interface Props {
  rentChargeIds: string[];
  label?: string;
}

export function RealizarRepasseButton({ rentChargeIds, label = "Realizar repasse" }: Props) {
  const router = useRouter();
  const [running, setRunning] = useState(false);

  async function handleClick() {
    if (rentChargeIds.length === 0) return;
    if (!confirm(`Realizar repasse de ${rentChargeIds.length} cobrança(s)?`)) return;
    setRunning(true);
    try {
      const res = await fetch("/api/locacao/repasses/realizar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rentChargeIds, agrupado: rentChargeIds.length > 1 }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { createdTransfers: number };
      toast.success(`${data.createdTransfers} transferência(s) reservada(s) pra dispatch`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Button size="sm" onClick={handleClick} disabled={running || rentChargeIds.length === 0}>
      <Send className="mr-1 h-3.5 w-3.5" />
      {running ? "..." : label}
    </Button>
  );
}
