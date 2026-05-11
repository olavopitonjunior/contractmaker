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
import { LifeBuoy, KeyRound, Mail } from "lucide-react";

/**
 * Botões pra recuperar uma subconta órfã (criada no Asaas mas que não chegou
 * no DB). Owner-only.
 *
 * Fluxo principal:
 *   1. "Recuperar conta órfã" tenta gerar nova apiKey via /accessTokens
 *      (master key da org-mãe).
 *   2. Se Asaas rejeitar com whitelist error (`invalid_action`), o endpoint
 *      automaticamente reenvia link de ativação pra subconta e retorna
 *      `mode: "activation_link_sent"`. Mostra hint pro usuário pegar a apiKey
 *      no email da subconta.
 *   3. Botão "Importar com apiKey existente" aceita o asaasId + apiKey
 *      colados manualmente e finaliza o cadastro local.
 */
export function RecoverOrphanButton() {
  const router = useRouter();
  const [openRecover, setOpenRecover] = useState(false);
  const [openImport, setOpenImport] = useState(false);
  const [busy, setBusy] = useState(false);

  // Recover state
  const [matches, setMatches] = useState<
    Array<{ asaasId: string; name: string; email: string; cpfCnpj: string; walletId: string }>
  >([]);
  const [activationHint, setActivationHint] = useState<{
    email: string;
    asaasId: string;
  } | null>(null);
  const [asaasId, setAsaasId] = useState("");
  const [cpfCnpj, setCpfCnpj] = useState("");
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");

  // Import state
  const [importAsaasId, setImportAsaasId] = useState("");
  const [importApiKey, setImportApiKey] = useState("");
  const [importLabel, setImportLabel] = useState("");

  async function submitRecover() {
    setBusy(true);
    setMatches([]);
    setActivationHint(null);
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
        if (data.error === "ACTIVATION_LINK_REQUIRED") {
          setActivationHint({ email: data.email, asaasId: data.asaasId });
          // Pre-popula o importAsaasId pra facilitar
          setImportAsaasId(data.asaasId);
          setImportLabel(label);
          toast.warning(
            `Asaas exige whitelist de IPs. ${data.activationResent ? `Link de ativação enviado pra ${data.email}.` : "Tentativa de reenvio falhou — solicite apiKey via suporte Asaas."} Abra o email, copie a apiKey e use "Importar com apiKey existente".`,
            { duration: 12000 }
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
      setOpenRecover(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function submitImport() {
    setBusy(true);
    try {
      if (!importAsaasId.trim() || !importApiKey.trim()) {
        toast.error("Preencha asaasId e apiKey");
        return;
      }
      const res = await fetch("/api/admin/accounts/import-with-apikey", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asaasId: importAsaasId.trim(),
          apiKey: importApiKey.trim(),
          label: importLabel.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Falha ao importar");
        return;
      }
      if (data.imported === false) {
        toast.info(data.message ?? "Subconta já estava cadastrada");
      } else {
        toast.success(
          `Importada! Status ${data.status} (${data.docsListed} docs KYC)`
        );
      }
      setOpenImport(false);
      setImportApiKey("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpenRecover(true)}>
        <LifeBuoy className="h-4 w-4 mr-1" />
        Recuperar conta órfã
      </Button>
      <Button variant="outline" size="sm" onClick={() => setOpenImport(true)}>
        <KeyRound className="h-4 w-4 mr-1" />
        Importar com apiKey
      </Button>

      {/* Recover dialog */}
      <Dialog open={openRecover} onOpenChange={setOpenRecover}>
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

            {activationHint && (
              <div className="border border-amber-300 bg-amber-50 rounded p-3 space-y-2 text-sm">
                <div className="flex items-start gap-2">
                  <Mail className="h-4 w-4 text-amber-700 mt-0.5 flex-shrink-0" />
                  <div className="space-y-1">
                    <p className="font-medium text-amber-900">
                      Whitelist de IPs bloqueia /accessTokens — link de ativação
                      enviado
                    </p>
                    <p className="text-xs text-amber-800">
                      Abra <strong>{activationHint.email}</strong>, clique no
                      link &quot;Ativar conta Asaas&quot;, defina senha, e
                      copie a apiKey no portal. Em seguida feche este dialog e
                      use o botão <strong>Importar com apiKey</strong>.
                    </p>
                    <code className="block text-[10px] text-amber-700 bg-amber-100 px-1.5 py-1 rounded">
                      asaasId: {activationHint.asaasId}
                    </code>
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpenRecover(false)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button onClick={submitRecover} disabled={busy}>
              {busy ? "Recuperando..." : "Recuperar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import-with-apikey dialog */}
      <Dialog open={openImport} onOpenChange={setOpenImport}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Importar subconta com apiKey existente</DialogTitle>
            <DialogDescription>
              Use quando você já tem a apiKey da subconta (ex: pegou no link de
              ativação que o Asaas enviou por email, ou via suporte). Vamos
              validar a apiKey e importar a conta localmente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="import-asaasid">asaasId</Label>
              <Input
                id="import-asaasid"
                value={importAsaasId}
                onChange={(e) => setImportAsaasId(e.target.value)}
                placeholder="Ex.: 4f468235-cec3-482f-b3d0-348af4c7194"
              />
              <p className="text-xs text-muted-foreground">
                ID único da subconta no Asaas — disponível no portal ou no
                resultado do botão &quot;Recuperar conta órfã&quot;.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="import-apikey">apiKey</Label>
              <Input
                id="import-apikey"
                type="password"
                value={importApiKey}
                onChange={(e) => setImportApiKey(e.target.value)}
                placeholder="$aact_prod_..."
              />
              <p className="text-xs text-muted-foreground">
                Começa com <code>$aact_prod_</code>. Será criptografada no DB
                (AES-256-GCM).
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="import-label">Rótulo (opcional)</Label>
              <Input
                id="import-label"
                value={importLabel}
                onChange={(e) => setImportLabel(e.target.value)}
                placeholder="Ex.: Newcore PJ"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpenImport(false)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button onClick={submitImport} disabled={busy}>
              {busy ? "Importando..." : "Importar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
