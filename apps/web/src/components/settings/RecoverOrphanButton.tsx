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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LifeBuoy } from "lucide-react";

/**
 * Botão pra recuperar uma subconta órfã (criada no Asaas mas que falhou
 * no commit local). Owner-only. Dispara POST /api/admin/accounts/recover-orphan.
 */
export function RecoverOrphanButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [matches, setMatches] = useState<
    Array<{ asaasId: string; name: string; email: string; cpfCnpj: string; walletId: string }>
  >([]);
  const [asaasId, setAsaasId] = useState("");
  const [cpfCnpj, setCpfCnpj] = useState("");
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");

  async function submit() {
    setBusy(true);
    setMatches([]);
    try {
      const body: Record<string, string> = {};
      if (asaasId.trim()) body.asaasId = asaasId.trim();
      if (cpfCnpj.trim()) body.cpfCnpj = cpfCnpj.replace(/\D/g, "");
      if (email.trim()) body.email = email.trim();
      if (label.trim()) body.label = label.trim();
      if (!body.asaasId && !body.cpfCnpj && !body.email) {
        toast.error("Preencha asaasId, CPF/CNPJ ou email");
        return;
      }
      const res = await fetch("/api/admin/accounts/recover-orphan", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "MULTIPLE_MATCHES" && Array.isArray(data.matches)) {
          setMatches(data.matches);
          toast.error(
            "Várias subcontas casaram — escolha pelo asaasId exato abaixo."
          );
          return;
        }
        toast.error(data.message ?? data.error ?? "Falha na recuperação");
        return;
      }
      if (data.recovered === false) {
        toast.info(data.message ?? "Subconta já estava cadastrada");
      } else {
        toast.success(
          `Recuperada! Status ${data.status} (${data.docsListed} docs KYC)`
        );
      }
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <LifeBuoy className="h-4 w-4 mr-1" />
        Recuperar conta órfã
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Recuperar subconta órfã</DialogTitle>
            <DialogDescription>
              Use quando uma subconta foi criada no Asaas mas não apareceu aqui
              (ex: erro no commit local após a criação). Vamos gerar uma nova
              apiKey e importar a conta. Informe pelo menos um filtro.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="recover-asaasid">asaasId (preferido)</Label>
              <Input
                id="recover-asaasid"
                value={asaasId}
                onChange={(e) => setAsaasId(e.target.value)}
                placeholder="Ex.: 4f468235-cec3-482f-b3d0-348af4c7194"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="recover-cpfcnpj">CPF/CNPJ</Label>
                <Input
                  id="recover-cpfcnpj"
                  value={cpfCnpj}
                  onChange={(e) => setCpfCnpj(e.target.value)}
                  placeholder="00.000.000/0001-90"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="recover-email">Email</Label>
                <Input
                  id="recover-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="conta@exemplo.com"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="recover-label">Rótulo (opcional)</Label>
              <Input
                id="recover-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Ex.: Newcore PJ"
              />
            </div>

            {matches.length > 0 && (
              <div className="border rounded p-2 space-y-2 text-sm">
                <p className="font-medium">Várias subcontas casaram:</p>
                <ul className="space-y-1">
                  {matches.map((m) => (
                    <li key={m.asaasId} className="flex items-center gap-2">
                      <button
                        type="button"
                        className="text-xs text-blue-600 hover:underline"
                        onClick={() => setAsaasId(m.asaasId)}
                      >
                        Selecionar
                      </button>
                      <span className="font-medium">{m.name}</span>
                      <code className="text-xs text-muted-foreground">
                        {m.asaasId.slice(0, 8)}...
                      </code>
                      <span className="text-xs text-muted-foreground">
                        ({m.email})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? "Recuperando..." : "Recuperar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
