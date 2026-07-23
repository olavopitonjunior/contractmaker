"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { parseMoneyBR } from "@/lib/format/money";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Building2, UsersRound, X } from "lucide-react";
import {
  IListPickerDialog,
  type IListImportPayload,
} from "@/components/ilist/IListPickerDialog";
import {
  WitnessPicker,
  pickNewWitnesses,
  type PickedWitness,
  type RegistryWitness,
} from "@/components/pipeline/WitnessPicker";
import { computeDedupeKey } from "@/lib/proposals/signer-dedupe";

const SCHEMA_BY_TIPO: Record<string, { label: string; value: string }[]> = {
  venda: [{ label: "Compra e venda", value: "compra_venda_v1" }],
  locacao: [
    { label: "Locação residencial", value: "locacao_residencial_v1" },
    { label: "Locação comercial", value: "locacao_comercial_v1" },
  ],
};

/**
 * Criação de proposta numa tela só. Monta o dataJson no shape que a conversão e
 * os templates esperam (proponente = comprador/locatário; imóvel; valor), então
 * o negócio nasce sem retradução.
 */
export function NovaPropostaDialog({ tipo }: { tipo: "venda" | "locacao" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [schemaType, setSchemaType] = useState(SCHEMA_BY_TIPO[tipo][0].value);
  const [witnessPickerOpen, setWitnessPickerOpen] = useState(false);
  const [witnesses, setWitnesses] = useState<PickedWitness[]>([]);
  const [form, setForm] = useState({
    proponente: "",
    proponenteEmail: "",
    proponenteFone: "",
    proponenteCanal: "email",
    vendedor: "",
    vendedorEmail: "",
    imovel: "",
    valor: "",
    validadeDias: "5",
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  // Snapshot completo do listing iList escolhido — entra em dataJson.imoveis[0]
  // (endereço + código + preço + ilistId) em vez do snapshot mínimo {endereco}.
  const [ilistSnapshot, setIlistSnapshot] = useState<
    IListImportPayload["proposalSnapshot"] | null
  >(null);

  function set(k: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Pré-filtro do picker (UX): não deixa escolher quem já é proponente/vendedor
  // ou já foi escolhido. `w.documentation` já vem só-dígitos de pickNewWitnesses.
  // O dedup AUTORITATIVO acontece no submit, com o mesmo computeDedupeKey do
  // servidor (evita colisão P2002 e duplo-envio independente da ordem de digitação).
  const witnessExistingKeys = [
    form.proponenteEmail.trim().toLowerCase(),
    form.vendedorEmail.trim().toLowerCase(),
    ...witnesses.map((w) => w.email.trim().toLowerCase()),
    ...witnesses.map((w) => w.documentation),
  ].filter(Boolean);

  function addWitnessesFromRegistry(selected: RegistryWitness[]) {
    setWitnesses((prev) => [
      ...prev,
      ...pickNewWitnesses(selected, witnessExistingKeys),
    ]);
  }

  function removeWitness(email: string) {
    setWitnesses((prev) => prev.filter((w) => w.email !== email));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.proponente.trim()) {
      toast.error("Informe o nome do proponente");
      return;
    }
    setSaving(true);
    try {
      const isVenda = tipo === "venda";
      const valor = form.valor ? parseMoneyBR(form.valor) : undefined;
      const dataJson: Record<string, unknown> = {
        imoveis:
          ilistSnapshot && ilistSnapshot.endereco === form.imovel
            ? [ilistSnapshot]
            : form.imovel
              ? [{ endereco: form.imovel }]
              : [],
      };
      if (isVenda) {
        dataJson.compradores = [{ nome: form.proponente }];
        dataJson.vendedores = [];
        if (valor != null) dataJson.pagamento = { valor_total: valor };
      } else {
        dataJson.locatarios = [{ nome: form.proponente }];
        dataJson.locadores = [];
        if (valor != null) dataJson.locacao = { valor_aluguel: valor };
      }

      const validUntil =
        form.validadeDias && Number(form.validadeDias) > 0
          ? new Date(Date.now() + Number(form.validadeDias) * 86_400_000).toISOString()
          : undefined;

      const signers: Record<string, unknown>[] = [
        {
          role: "proponente",
          name: form.proponente,
          email: form.proponenteEmail || null,
          phone: form.proponenteFone || null,
          notifyChannel: form.proponenteCanal,
          signingGroup: 1,
        },
      ];
      if (form.vendedor.trim()) {
        signers.push({
          role: "vendedor",
          name: form.vendedor,
          email: form.vendedorEmail || null,
          notifyChannel: "email",
          signingGroup: 2,
        });
      }
      // Testemunhas escolhidas do cadastro (scope proposta) — assinam junto com
      // os proprietários (grupo 2). Dedup AUTORITATIVO aqui com o MESMO
      // computeDedupeKey do servidor: descarta testemunha que colide com
      // proponente/vendedor/outra testemunha (senão o @@unique(proposalId,
      // dedupeKey) estoura P2002 e derruba a proposta inteira) e ignora
      // testemunha sem e-mail (canal e-mail → o preflight bloquearia o envio).
      const seenKeys = new Set(
        signers.map((s) =>
          computeDedupeKey({
            name: String(s.name ?? ""),
            email: (s.email as string | null) ?? null,
            cpf: (s.cpf as string | null) ?? null,
            phone: (s.phone as string | null) ?? null,
          })
        )
      );
      for (const w of witnesses) {
        if (!w.email.trim()) continue;
        const key = computeDedupeKey({
          name: w.name,
          email: w.email,
          cpf: w.documentation || null,
          phone: w.phone || null,
        });
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        signers.push({
          role: "testemunha",
          name: w.name,
          email: w.email,
          cpf: w.documentation || null,
          phone: w.phone || null,
          notifyChannel: "email",
          signingGroup: 2,
        });
      }

      const res = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${form.proponente}${form.imovel ? ` — ${form.imovel}` : ""}`,
          schemaType,
          dataJson,
          validUntil,
          signers,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const { proposal } = await res.json();
      toast.success("Proposta criada");
      setWitnesses([]);
      setOpen(false);
      router.push(`/pipeline/propostas/${proposal.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" /> Nova proposta
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova proposta — {tipo === "venda" ? "Vendas" : "Locação"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label>Proponente</Label>
            <Input
              value={form.proponente}
              onChange={(e) => set("proponente", e.target.value)}
              placeholder="Nome do comprador/locatário"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>E-mail do proponente</Label>
              <Input
                type="email"
                value={form.proponenteEmail}
                onChange={(e) => set("proponenteEmail", e.target.value)}
                placeholder="cliente@email.com"
              />
            </div>
            <div className="space-y-1">
              <Label>Telefone (WhatsApp)</Label>
              <Input
                inputMode="tel"
                value={form.proponenteFone}
                onChange={(e) => set("proponenteFone", e.target.value)}
                placeholder="(41) 99999-9999"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Canal de assinatura</Label>
            <Select
              value={form.proponenteCanal}
              onValueChange={(v) => set("proponenteCanal", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">E-mail</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Vendedor (opcional)</Label>
              <Input
                value={form.vendedor}
                onChange={(e) => set("vendedor", e.target.value)}
                placeholder="Nome do proprietário"
              />
            </div>
            <div className="space-y-1">
              <Label>E-mail do vendedor</Label>
              <Input
                type="email"
                value={form.vendedorEmail}
                onChange={(e) => set("vendedorEmail", e.target.value)}
                placeholder="proprietario@email.com"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Testemunhas (opcional)</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setWitnessPickerOpen(true)}
              >
                <UsersRound className="mr-1 h-3.5 w-3.5" />
                Selecionar testemunhas
              </Button>
            </div>
            {witnesses.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {witnesses.map((w) => (
                  <span
                    key={w.email}
                    className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-xs"
                  >
                    {w.name}
                    <button
                      type="button"
                      onClick={() => removeWitness(w.email)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Remover ${w.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-1">
            <Label>Imóvel</Label>
            <div className="flex gap-2">
              <Input
                value={form.imovel}
                onChange={(e) => set("imovel", e.target.value)}
                placeholder="Endereço do imóvel"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                title="Buscar no catálogo iList (RE/MAX)"
                onClick={() => setPickerOpen(true)}
              >
                <Building2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <IListPickerDialog
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            transactionType={tipo}
            onSelect={(payload: IListImportPayload) => {
              setIlistSnapshot(payload.proposalSnapshot);
              setForm((f) => ({
                ...f,
                imovel: payload.proposalSnapshot.endereco,
                // Preço do listing pré-preenche o valor quando ainda vazio.
                valor:
                  f.valor ||
                  (payload.proposalSnapshot.preco != null
                    ? payload.proposalSnapshot.preco.toLocaleString("pt-BR", {
                        minimumFractionDigits: 2,
                      })
                    : f.valor),
              }));
            }}
          />
          {SCHEMA_BY_TIPO[tipo].length > 1 && (
            <div className="space-y-1">
              <Label>Modelo</Label>
              <Select value={schemaType} onValueChange={setSchemaType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCHEMA_BY_TIPO[tipo].map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{tipo === "venda" ? "Valor (R$)" : "Aluguel (R$/mês)"}</Label>
              <Input
                inputMode="numeric"
                value={form.valor}
                onChange={(e) => set("valor", e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1">
              <Label>Validade (dias)</Label>
              <Input
                inputMode="numeric"
                value={form.validadeDias}
                onChange={(e) => set("validadeDias", e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving ? "Criando…" : "Criar rascunho"}
            </Button>
          </DialogFooter>
        </form>

        <WitnessPicker
          open={witnessPickerOpen}
          onOpenChange={setWitnessPickerOpen}
          scope="proposta"
          existingKeys={witnessExistingKeys}
          onConfirm={addWitnessesFromRegistry}
        />
      </DialogContent>
    </Dialog>
  );
}
