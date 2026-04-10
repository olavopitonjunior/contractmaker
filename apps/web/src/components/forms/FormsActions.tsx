"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ExternalLink, Copy, Plus, Check } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

interface FormsActionsProps {
  formId: string;
  token: string;
  status: string;
  hasDeal: boolean;
  title: string | null;
}

export function FormsActions({ formId, token, status, hasDeal, title }: FormsActionsProps) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);

  function handleCopy() {
    const url = `${window.location.origin}/f/${token}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Link copiado!");
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleCreateDeal() {
    setCreating(true);
    const res = await fetch("/api/pipeline/deals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        formId,
        title: title || `Negocio - ${token.slice(0, 8)}`,
        value: 0,
      }),
    });
    setCreating(false);

    if (res.ok) {
      const deal = await res.json();
      toast.success("Negocio criado!");
      router.push(`/deals/${deal.id}`);
    } else {
      toast.error("Erro ao criar negocio");
    }
  }

  return (
    <div className="flex gap-2 flex-wrap">
      <Button variant="outline" size="sm" asChild>
        <Link href={`/f/${token}`} target="_blank">
          <ExternalLink className="mr-1 h-3 w-3" />
          Abrir
        </Link>
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={handleCopy}
      >
        {copied ? (
          <Check className="mr-1 h-3 w-3" />
        ) : (
          <Copy className="mr-1 h-3 w-3" />
        )}
        {copied ? "Copiado!" : "Copiar"}
      </Button>
      {status === "completo" && !hasDeal && (
        <Button
          size="sm"
          onClick={handleCreateDeal}
          disabled={creating}
        >
          <Plus className="mr-1 h-3 w-3" />
          {creating ? "Criando..." : "Criar Negocio"}
        </Button>
      )}
    </div>
  );
}
