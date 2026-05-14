"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ExternalLink, Copy, Plus, Check, Users } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

interface FormsActionsProps {
  formId: string;
  token: string;
  status: string;
  hasDeal: boolean;
  dealId?: string | null;
  title: string | null;
}

export function FormsActions({ formId, token, status, hasDeal, dealId, title }: FormsActionsProps) {
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
        title: title || `Negócio - ${token.slice(0, 8)}`,
        value: 0,
      }),
    });
    setCreating(false);

    if (res.ok) {
      const deal = await res.json();
      toast.success("Negócio criado!");
      router.push(`/deals/${deal.id}`);
    } else {
      toast.error("Erro ao criar negocio");
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleCopy}
        className="w-full truncate rounded border border-dashed bg-muted/40 px-2 py-1 text-left text-[11px] font-mono text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        title="Clique para copiar o link"
      >
        /f/{token}
      </button>
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
          {copied ? "Copiado!" : "Copiar link"}
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/forms/${formId}/share`}>
            <Users className="mr-1 h-3 w-3" />
            Compartilhar por parte
          </Link>
        </Button>
        {hasDeal && dealId && (
          <Button size="sm" variant="outline" asChild>
            <Link href={`/deals/${dealId}`}>
              Ver Negócio
            </Link>
          </Button>
        )}
        {status === "completo" && !hasDeal && (
          <Button
            size="sm"
            onClick={handleCreateDeal}
            disabled={creating}
          >
            <Plus className="mr-1 h-3 w-3" />
            {creating ? "Criando..." : "Criar Negócio"}
          </Button>
        )}
      </div>
    </div>
  );
}
