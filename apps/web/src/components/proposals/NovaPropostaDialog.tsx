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
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, UserPlus, Building2 } from "lucide-react";
import {
  IListPickerDialog,
  type IListImportPayload,
} from "@/components/ilist/IListPickerDialog";

const SCHEMA_BY_TIPO: Record<string, { label: string; value: string }[]> = {
  venda: [{ label: "Compra e venda", value: "compra_venda_v1" }],
  locacao: [
    { label: "Locação residencial", value: "locacao_residencial_v1" },
    { label: "Locação comercial", value: "locacao_comercial_v1" },
  ],
};

interface Party {
  name: string;
  email: string;
  phone: string;
  canal: string; // email | whatsapp
}

const emptyParty = (): Party => ({ name: "", email: "", phone: "", canal: "email" });

/**
 * Criação de proposta numa tela só, com N proponentes + N proprietários, cada um
 * com seu canal de assinatura (e-mail/WhatsApp — pode misturar, e >1 por
 * WhatsApp). Monta o dataJson no shape que a conversão e os templates esperam
 * (compradores/vendedores ou locatarios/locadores), então o negócio nasce sem
 * retradução. O backend (`/api/proposals`) já aceita o array de signers.
 */
export function NovaPropostaDialog({ tipo }: { tipo: "venda" | "locacao" }) {
  const router = useRouter();
  const isVenda = tipo === "venda";
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [schemaType, setSchemaType] = useState(SCHEMA_BY_TIPO[tipo][0].value);
  const [proponentes, setProponentes] = useState<Party[]>([emptyParty()]);
  const [vendedores, setVendedores] = useState<Party[]>([]);
  const [imovel, setImovel] = useState("");
  const [valor, setValor] = useState("");
  const [validadeDias, setValidadeDias] = useState("5");
  const [comissao, setComissao] = useState(false);
  const [esconderComissao, setEsconderComissao] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Snapshot completo do listing iList escolhido — entra em dataJson.imoveis[0]
  // (endereço + código + preço + ilistId) em vez do snapshot mínimo {endereco}.
  const [ilistSnapshot, setIlistSnapshot] = useState<
    IListImportPayload["proposalSnapshot"] | null
  >(null);

  const proponenteLabel = isVenda ? "Comprador" : "Locatário";
  const vendedorLabel = isVenda ? "Proprietário / Vendedor" : "Locador";

  function updateParty(
    list: Party[],
    setList: (p: Party[]) => void,
    idx: number,
    patch: Partial<Party>
  ) {
    setList(list.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validProponentes = proponentes.filter((p) => p.name.trim());
    if (validProponentes.length === 0) {
      toast.error(`Informe ao menos um ${proponenteLabel.toLowerCase()}`);
      return;
    }
    const validVendedores = vendedores.filter((p) => p.name.trim());
    setSaving(true);
    try {
      // parseMoneyBR (não o replace bugado) — senão "1.500" vira 1500 ok mas
      // "1000.00" viraria 100000. Estrutura nova do dialog (staging) + parse
      // correto (master/ALTO-1).
      const valorNum = valor ? parseMoneyBR(valor) : undefined;
      const dataJson: Record<string, unknown> = {
        imoveis:
          ilistSnapshot && ilistSnapshot.endereco === imovel
            ? [ilistSnapshot]
            : imovel
              ? [{ endereco: imovel }]
              : [],
      };
      const propNomes = validProponentes.map((p) => ({ nome: p.name }));
      const vendNomes = validVendedores.map((p) => ({ nome: p.name }));
      if (isVenda) {
        dataJson.compradores = propNomes;
        dataJson.vendedores = vendNomes;
        if (valorNum != null) dataJson.pagamento = { valor_total: valorNum };
      } else {
        dataJson.locatarios = propNomes;
        dataJson.locadores = vendNomes;
        if (valorNum != null) dataJson.locacao = { valor_aluguel: valorNum };
      }

      const validUntil =
        validadeDias && Number(validadeDias) > 0
          ? new Date(Date.now() + Number(validadeDias) * 86_400_000).toISOString()
          : undefined;

      const signers: Record<string, unknown>[] = [
        ...validProponentes.map((p) => ({
          role: "proponente",
          name: p.name,
          email: p.email || null,
          phone: p.phone || null,
          notifyChannel: p.canal,
          signingGroup: 1,
        })),
        ...validVendedores.map((p) => ({
          role: "vendedor",
          name: p.name,
          email: p.email || null,
          phone: p.phone || null,
          notifyChannel: p.canal,
          signingGroup: 2,
        })),
      ];

      const title = `${validProponentes[0].name}${imovel ? ` — ${imovel}` : ""}`;
      // Esconder a comissão só faz sentido com comissão incluída + proprietário
      // assinando (2ª via reduzida). hiddenPaths não-vazio dispara a via reduzida.
      const hide = comissao && esconderComissao && validVendedores.length > 0;
      const res = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          schemaType,
          dataJson,
          validUntil,
          signers,
          comissaoIncluida: comissao,
          hiddenPaths: hide ? ["comissao"] : [],
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const { proposal } = await res.json();
      toast.success("Proposta criada");
      setOpen(false);
      router.push(`/pipeline/propostas/${proposal.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar");
    } finally {
      setSaving(false);
    }
  }

  const renderParties = (
    list: Party[],
    setList: (p: Party[]) => void,
    roleLabel: string,
    removableToZero: boolean
  ) =>
    list.map((p, idx) => (
      <div key={idx} className="rounded-md border p-2 space-y-2">
        <div className="flex items-center gap-2">
          <Input
            value={p.name}
            onChange={(e) => updateParty(list, setList, idx, { name: e.target.value })}
            placeholder={`Nome do ${roleLabel.toLowerCase()}`}
            autoFocus={idx === 0 && list === proponentes}
          />
          {(removableToZero || list.length > 1) && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground"
              onClick={() => setList(list.filter((_, i) => i !== idx))}
              aria-label="Remover"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="grid grid-cols-[1fr_1fr_130px] gap-2">
          <Input
            type="email"
            value={p.email}
            onChange={(e) => updateParty(list, setList, idx, { email: e.target.value })}
            placeholder="e-mail"
          />
          <Input
            inputMode="tel"
            value={p.phone}
            onChange={(e) => updateParty(list, setList, idx, { phone: e.target.value })}
            placeholder="(DDD) WhatsApp"
          />
          <Select
            value={p.canal}
            onValueChange={(v) => updateParty(list, setList, idx, { canal: v })}
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
      </div>
    ));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" /> Nova proposta
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova proposta — {tipo === "venda" ? "Vendas" : "Locação"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Proponentes */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{proponenteLabel}(es) — quem faz a proposta</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setProponentes([...proponentes, emptyParty()])}
              >
                <UserPlus className="mr-1 h-3.5 w-3.5" /> Adicionar
              </Button>
            </div>
            {renderParties(proponentes, setProponentes, proponenteLabel, false)}
          </div>

          {/* Proprietários / Vendedores */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{vendedorLabel}(es) — opcional</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setVendedores([...vendedores, emptyParty()])}
              >
                <UserPlus className="mr-1 h-3.5 w-3.5" /> Adicionar
              </Button>
            </div>
            {vendedores.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Adicione se o {vendedorLabel.toLowerCase()} também vai assinar.
              </p>
            ) : (
              renderParties(vendedores, setVendedores, vendedorLabel, true)
            )}
          </div>

          <div className="space-y-1">
            <Label>Imóvel</Label>
            <div className="flex gap-2">
              <Input
                value={imovel}
                onChange={(e) => setImovel(e.target.value)}
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
              setImovel(payload.proposalSnapshot.endereco);
              // Preço do listing pré-preenche o valor quando ainda vazio.
              if (payload.proposalSnapshot.preco != null) {
                setValor((v) =>
                  v ||
                  payload.proposalSnapshot.preco!.toLocaleString("pt-BR", {
                    minimumFractionDigits: 2,
                  }),
                );
              }
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
              <Label>{isVenda ? "Valor (R$)" : "Aluguel (R$/mês)"}</Label>
              <Input
                inputMode="numeric"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1">
              <Label>Validade (dias)</Label>
              <Input
                inputMode="numeric"
                value={validadeDias}
                onChange={(e) => setValidadeDias(e.target.value)}
              />
            </div>
          </div>

          {/* Comissão + ocultação do proprietário */}
          <div className="space-y-2 rounded-md border p-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={comissao} onCheckedChange={(v) => setComissao(Boolean(v))} />
              Incluir comissão da imobiliária no documento
            </label>
            {comissao && vendedores.some((p) => p.name.trim()) && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={esconderComissao}
                  onCheckedChange={(v) => setEsconderComissao(Boolean(v))}
                />
                Esconder a comissão do {vendedorLabel.toLowerCase()} (ele assina uma via reduzida)
              </label>
            )}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving ? "Criando…" : "Criar rascunho"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
