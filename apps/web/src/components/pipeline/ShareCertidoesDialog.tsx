"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Copy, Link2, Loader2, Trash2 } from "lucide-react";

interface ShareLink {
  token: string;
  url: string;
  expiresAt: string;
  viewCount: number;
}

interface Props {
  dealId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareCertidoesDialog({ dealId, open, onOpenChange }: Props) {
  const [link, setLink] = useState<ShareLink | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/deals/${dealId}/certidoes/share`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setLink(data.link ?? null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, dealId]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/certidoes/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiryDays: 7 }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Falha ao gerar link");
        return;
      }
      setLink({
        token: data.token,
        url: data.url,
        expiresAt: data.expiresAt,
        viewCount: data.viewCount ?? 0,
      });
      toast.success(data.reused ? "Link ativo encontrado" : "Link gerado");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async () => {
    if (!link) return;
    const res = await fetch(`/api/certidoes/share/${link.token}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setLink(null);
      toast.success("Link revogado");
    } else {
      toast.error("Falha ao revogar");
    }
  };

  const publicUrl = link
    ? `${typeof window !== "undefined" ? window.location.origin : ""}${link.url}`
    : "";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success("Link copiado");
    } catch {
      toast.error("Falha ao copiar");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Compartilhar certidões
          </DialogTitle>
          <DialogDescription>
            Gere um link temporário para enviar as certidões ao cliente, banco
            ou advogado. O link expira em 7 dias e pode ser revogado a qualquer
            momento.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : link ? (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">
                Link público (válido até{" "}
                {new Date(link.expiresAt).toLocaleDateString("pt-BR")})
              </label>
              <div className="flex gap-2 mt-1">
                <Input value={publicUrl} readOnly className="font-mono text-xs" />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleCopy}
                  title="Copiar"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Visualizado{" "}
              <strong>{link.viewCount}</strong>{" "}
              {link.viewCount === 1 ? "vez" : "vezes"}
            </p>
          </div>
        ) : (
          <div className="py-4 text-sm text-muted-foreground">
            Nenhum link ativo. Clique em &ldquo;Gerar link&rdquo; para criar um.
          </div>
        )}

        <DialogFooter>
          {link ? (
            <Button
              variant="outline"
              onClick={handleRevoke}
              className="text-destructive border-destructive/30"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Revogar link
            </Button>
          ) : (
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Gerando…
                </>
              ) : (
                <>
                  <Link2 className="h-4 w-4 mr-1" />
                  Gerar link
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
