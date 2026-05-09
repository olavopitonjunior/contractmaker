"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CompleteRecipientForm({ token }: { token: string }) {
  const [pixKey, setPixKey] = useState("");
  const [walletId, setWalletId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, string> = { token };
      if (pixKey.trim()) body.pixAddressKey = pixKey.trim();
      if (walletId.trim()) body.walletId = walletId.trim();
      const res = await fetch("/api/public/split-recipients/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Erro ${res.status}`);
        return;
      }
      setDone(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="border rounded p-4 bg-green-50 text-green-900 text-sm">
        Cadastro completo. Você já pode receber repasses.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 bg-white border rounded p-5">
      <div>
        <Label htmlFor="pix">Chave PIX</Label>
        <Input
          id="pix"
          value={pixKey}
          onChange={(e) => setPixKey(e.target.value)}
          placeholder="CPF, CNPJ, email, telefone ou EVP"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Preencha apenas se você foi cadastrado como PIX externo.
        </p>
      </div>

      <div>
        <Label htmlFor="wallet">Wallet ID Asaas</Label>
        <Input
          id="wallet"
          value={walletId}
          onChange={(e) => setWalletId(e.target.value)}
          placeholder="UUID do seu wallet Asaas"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Preencha apenas se você foi cadastrado como conta Asaas.
        </p>
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
          {error}
        </div>
      )}

      <Button type="submit" disabled={submitting || (!pixKey && !walletId)} className="w-full">
        {submitting ? "Salvando..." : "Salvar"}
      </Button>
    </form>
  );
}
