"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { BookMarked, Loader2 } from "lucide-react";

/**
 * "Usar cláusulas padrão (Lei 8.245/91)": semeia o conjunto curado de cláusulas
 * de locação na base de conhecimento. Idempotente no servidor. Reusado na página
 * de configurações e no wizard de onboarding.
 */
export function KnowledgeSeedButton({ onDone }: { onDone?: () => void }) {
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    try {
      const res = await fetch("/api/knowledge/seed-defaults", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Falha ao semear cláusulas.");
        return;
      }
      if (data.created > 0) {
        toast.success(`${data.created} cláusula(s) padrão adicionada(s).`);
      } else {
        toast.info("As cláusulas padrão já estavam na base.");
      }
      onDone?.();
    } catch {
      toast.error("Falha ao semear cláusulas.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={loading}>
      {loading ? (
        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
      ) : (
        <BookMarked className="h-4 w-4 mr-1" />
      )}
      Usar cláusulas padrão (Lei 8.245/91)
    </Button>
  );
}
