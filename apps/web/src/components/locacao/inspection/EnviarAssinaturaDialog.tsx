"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Send, Plus, Trash2 } from "lucide-react";
import { CLICKSIGN_ROLE_OPTIONS, type ClicksignRole } from "@/lib/clicksign/roles";

export interface SignerSuggestion {
  name: string;
  email: string;
  /** Origem exibida como hint (Locatário / Proprietário). */
  origem: string;
}

interface SignerRow {
  name: string;
  email: string;
  role: ClicksignRole;
  origem: string;
}

interface Props {
  inspectionId: string;
  suggestions: SignerSuggestion[];
  /** false quando o contrato não tem deal de origem (Envelope exige dealId). */
  available: boolean;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EnviarAssinaturaDialog({ inspectionId, suggestions, available }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [rows, setRows] = useState<SignerRow[]>(
    suggestions.map((s) => ({ name: s.name, email: s.email, role: "party", origem: s.origem }))
  );

  function setRow(i: number, patch: Partial<SignerRow>) {
    setRows((prev) => prev.map((r, ri) => (ri === i ? { ...r, ...patch } : r)));
  }

  const valid = rows.length > 0 && rows.every((r) => r.name.trim().length >= 2 && EMAIL_REGEX.test(r.email));

  async function handleSend() {
    setSending(true);
    try {
      const res = await fetch(`/api/locacao/inspections/${inspectionId}/send-signature`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signers: rows.map((r) => ({
            name: r.name.trim(),
            email: r.email.trim().toLowerCase(),
            role: r.role,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = typeof data?.error === "string" ? data.error : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      toast.success("Laudo enviado pra assinatura via ClickSign");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro no envio");
    } finally {
      setSending(false);
    }
  }

  if (!available) {
    return (
      <Button size="sm" variant="outline" disabled title="Contrato sem negócio de origem — assinatura indisponível">
        <Send className="mr-1.5 h-3.5 w-3.5" /> Enviar pra assinatura
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Send className="mr-1.5 h-3.5 w-3.5" /> Enviar pra assinatura
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Assinatura do laudo (ClickSign)</DialogTitle>
          <DialogDescription>
            O laudo PDF vai pra assinatura eletrônica das partes. Custo por signatário: R$
            1,50.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_120px_32px] items-center gap-2">
              <div>
                <Input
                  placeholder="Nome"
                  className="h-8 text-sm"
                  value={r.name}
                  onChange={(e) => setRow(i, { name: e.target.value })}
                />
                {r.origem && (
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {r.origem}
                  </span>
                )}
              </div>
              <Input
                placeholder="E-mail"
                type="email"
                className="h-8 text-sm"
                value={r.email}
                onChange={(e) => setRow(i, { email: e.target.value })}
              />
              <Select value={r.role} onValueChange={(v) => setRow(i, { role: v as ClicksignRole })}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLICKSIGN_ROLE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setRows((prev) => prev.filter((_, ri) => ri !== i))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              setRows((prev) => [...prev, { name: "", email: "", role: "party", origem: "" }])
            }
          >
            <Plus className="mr-1 h-3 w-3" /> Signatário
          </Button>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={sending}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSend} disabled={!valid || sending}>
            {sending ? "Enviando…" : `Enviar (${rows.length} signatário${rows.length === 1 ? "" : "s"})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
