"use client";

import { useId, useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Landmark, Mail } from "lucide-react";
import { NativeSelect } from "@/components/forms/NativeSelect";

function FormField({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <Label className="text-sm font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

interface RecebimentoState {
  pixAddressKey: string;
  bankName: string;
  bankBranch: string;
  bankAccount: string;
  bankAccountType: string;
  bankHolderName: string;
  bankHolderDoc: string;
}

const EMPTY_RECEBIMENTO: RecebimentoState = {
  pixAddressKey: "",
  bankName: "",
  bankBranch: "",
  bankAccount: "",
  bankAccountType: "corrente",
  bankHolderName: "",
  bankHolderDoc: "",
};

function hasAnyRecebimento(r: RecebimentoState): boolean {
  return !!(
    r.pixAddressKey.trim() ||
    r.bankName.trim() ||
    r.bankBranch.trim() ||
    r.bankAccount.trim() ||
    r.bankHolderName.trim() ||
    r.bankHolderDoc.trim()
  );
}

/**
 * Dados de recebimento da comissão (PIX + conta bancária) e o botão que
 * persiste o comissionado como SplitRecipient. Compartilhado entre o form de
 * VENDA (`comissao.comissionados[i]`) e o de LOCAÇÃO (`comissao.angariadores[i]`)
 * — os campos de qualificação têm os mesmos nomes nos dois schemas.
 *
 * Este estado NÃO vive no react-hook-form DE PROPÓSITO. O que está no RHF é
 * autossalvo em `SalesForm.dataJson`, e o dataJson é devolvido inteiro por
 * GET /api/forms/[token] pra qualquer portador do link — que inclui o cliente,
 * e o resumo enviado por e-mail. Chave PIX e conta do corretor não podem
 * trafegar por aí. Aqui os campos são write-only: sobem no POST, ficam no
 * SplitRecipient (cuja whitelist no GET público nunca expõe PII bancária) e
 * saem da tela.
 *
 * Só chave PIX torna o cadastro pagável pela esteira (`pix_external`). Conta
 * bancária é TED manual: fica guardada pro repasse fora da esteira e o
 * cadastro segue rascunho — mesma convenção do cadastro admin.
 *
 * Cadastro JÁ vinculado (splitRecipientId presente): membros ganham o botão
 * "Pedir dados ao corretor", que reusa o magic link de completion
 * (/api/financeiro/split-recipients/[id]/request-completion) — o corretor
 * preenche PIX/banco num link próprio e seguro, por e-mail.
 */
export function CadastroRecebimento({
  form,
  basePath,
  endpoint,
  papelDefault,
  showReceiving,
}: {
  form: UseFormReturn<any>;
  /** Prefixo RHF da linha, ex. `comissao.comissionados.0`. */
  basePath: string;
  /** POST de cadastro, ex. `/api/forms/<token>/commissioners`. */
  endpoint: string;
  /** Papel enviado quando a linha não tem campo próprio (locação = captador). */
  papelDefault: string;
  /** Visitante é membro da imobiliária — só então PIX/banco aparecem. */
  showReceiving: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [open, setOpen] = useState(false);
  const [receb, setReceb] = useState<RecebimentoState>(EMPTY_RECEBIMENTO);
  const fieldId = useId();

  const splitRecipientId = form.watch(`${basePath}.splitRecipientId`) as
    | string
    | undefined;

  const set = (patch: Partial<RecebimentoState>) => setReceb((r) => ({ ...r, ...patch }));

  const handleRequestCompletion = async () => {
    if (!splitRecipientId) return;
    setRequesting(true);
    try {
      const res = await fetch(
        `/api/financeiro/split-recipients/${splitRecipientId}/request-completion`,
        { method: "POST" }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          body?.error ??
            "Não foi possível enviar o pedido — confira se o cadastro tem e-mail."
        );
        return;
      }
      toast.success("Pedido enviado: o corretor recebe por e-mail um link seguro pra preencher os dados de recebimento.");
    } catch (err) {
      console.error("[CadastroRecebimento request-completion]", err);
      toast.error("Erro ao enviar o pedido.");
    } finally {
      setRequesting(false);
    }
  };

  const handleSave = async () => {
    const tipoPessoa = (form.getValues(`${basePath}.tipo_pessoa`) || "juridica") as
      | "fisica"
      | "juridica";
    const nome = String(form.getValues(`${basePath}.nome`) || "").trim();
    const doc = String(
      form.getValues(tipoPessoa === "fisica" ? `${basePath}.cpf` : `${basePath}.cnpj`) || ""
    ).trim();
    if (!nome || !doc) {
      toast.error("Preencha pelo menos Nome e CPF/CNPJ antes de salvar.");
      return;
    }

    const chavePix = receb.pixAddressKey.trim();
    // `titularCpfCnpj` tem min(11) no schema da rota — mandar um doc curto
    // reprovaria o body inteiro. Sem doc válido, o titular fica implícito.
    const docDigits = doc.replace(/\D/g, "");
    const pix = chavePix
      ? {
          chave: chavePix,
          titularNome: nome,
          titularCpfCnpj: docDigits.length >= 11 ? doc : undefined,
        }
      : undefined;

    const banco =
      receb.bankName.trim() ||
      receb.bankBranch.trim() ||
      receb.bankAccount.trim() ||
      receb.bankHolderName.trim() ||
      receb.bankHolderDoc.trim()
        ? {
            nome: receb.bankName.trim() || undefined,
            agencia: receb.bankBranch.trim() || undefined,
            conta: receb.bankAccount.trim() || undefined,
            tipoConta: receb.bankAccount.trim()
              ? (receb.bankAccountType as "corrente" | "poupanca")
              : undefined,
            titularNome: receb.bankHolderName.trim() || undefined,
            titularDoc: receb.bankHolderDoc.trim() || undefined,
          }
        : undefined;

    setSaving(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: nome,
          tipoPessoa,
          cpfCnpj: doc,
          creci: String(form.getValues(`${basePath}.creci`) || "") || undefined,
          papel: form.getValues(`${basePath}.papel`) || papelDefault,
          email: String(form.getValues(`${basePath}.email`) || "") || undefined,
          phone: String(form.getValues(`${basePath}.mobile_phone`) || "") || undefined,
          pix,
          banco,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error ?? "Falha ao salvar cadastro.");
        return;
      }
      const data = await res.json();
      const recipientId = data?.recipient?.id;
      if (recipientId) {
        form.setValue(`${basePath}.splitRecipientId`, recipientId, { shouldDirty: true });
      }
      // Some da tela: o dado agora vive no cadastro, e este formulário não é
      // lugar pra guardar chave PIX/conta.
      setReceb(EMPTY_RECEBIMENTO);
      setOpen(false);
      if (data?.existed && data?.receivingIgnored) {
        // Não mentir: a rota ignora dados de recebimento de cadastro existente.
        toast.warning(
          "Cadastro já existia e foi vinculado. Por segurança, os dados de recebimento não foram alterados — peça à imobiliária para atualizá-los."
        );
      } else if (data?.existed) {
        toast.success("Cadastro já existia e foi vinculado.");
      } else if (chavePix) {
        toast.success(
          "Cadastro salvo com a chave PIX. A imobiliária confirma o meio de repasse antes do primeiro pagamento."
        );
      } else if (data?.isDraft) {
        toast.success(
          "Cadastro salvo. Sem chave PIX ele fica como rascunho — a imobiliária completa o meio de repasse depois."
        );
      } else {
        toast.success("Cadastro salvo. Próximos negócios podem reusá-lo.");
      }
    } catch (err) {
      console.error("[CadastroRecebimento]", err);
      toast.error("Erro ao salvar cadastro.");
    } finally {
      setSaving(false);
    }
  };

  const preenchido = hasAnyRecebimento(receb);

  // Cadastro já vinculado: nada a salvar aqui. Membro ganha o pedido por
  // magic link; cliente vê só a nota de que o dado é mantido pela imobiliária.
  if (splitRecipientId) {
    if (!showReceiving) {
      return (
        <p className="pt-2 border-t border-dashed text-xs text-muted-foreground">
          Dados de recebimento deste cadastro são mantidos pela imobiliária.
        </p>
      );
    }
    return (
      <div className="pt-2 border-t border-dashed flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-sm font-semibold flex items-center gap-1.5">
            <Landmark className="h-4 w-4" /> Dados para recebimento da comissão
          </p>
          <p className="text-xs text-muted-foreground">
            Mantidos no cadastro do corretor. Sem chave PIX, o repasse automático não sai.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleRequestCompletion}
          disabled={requesting}
        >
          <Mail className="h-3.5 w-3.5 mr-1.5" />
          {requesting ? "Enviando…" : "Pedir dados ao corretor"}
        </Button>
      </div>
    );
  }

  return (
    <div className="pt-2 border-t border-dashed space-y-3">
      {showReceiving && (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-sm font-semibold flex items-center gap-1.5">
              <Landmark className="h-4 w-4" /> Dados para recebimento da comissão
            </p>
            <p className="text-xs text-muted-foreground">
              Chave PIX habilita o repasse automático. Vão direto pro cadastro da
              imobiliária — não ficam salvos neste formulário nem aparecem pra quem
              mais tem o link.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant={open ? "ghost" : "outline"}
            onClick={() => setOpen((v) => !v)}
          >
            <Landmark className="h-3.5 w-3.5 mr-1.5" />
            {open ? "Ocultar" : "Preencher dados bancários"}
          </Button>
        </div>
      )}

      {showReceiving && open && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-md border border-dashed bg-background/60 p-3">
          <FormField label="Chave PIX" className="md:col-span-2">
            <Input
              id={`${fieldId}-pix`}
              value={receb.pixAddressKey}
              onChange={(e) => set({ pixAddressKey: e.target.value })}
              maxLength={200}
              placeholder="CPF, CNPJ, e-mail, telefone ou chave aleatória"
            />
            <p className="text-xs text-muted-foreground">
              É o que permite o repasse automático da comissão. A imobiliária
              confirma a chave antes do primeiro pagamento.
            </p>
          </FormField>

          <FormField label="Banco">
            <Input
              value={receb.bankName}
              onChange={(e) => set({ bankName: e.target.value })}
              maxLength={80}
              placeholder="Ex: Itaú"
            />
          </FormField>
          <FormField label="Agência">
            <Input
              value={receb.bankBranch}
              onChange={(e) => set({ bankBranch: e.target.value })}
              maxLength={20}
              placeholder="0000"
            />
          </FormField>
          <FormField label="Conta">
            <Input
              value={receb.bankAccount}
              onChange={(e) => set({ bankAccount: e.target.value })}
              maxLength={30}
              placeholder="00000-0"
            />
          </FormField>
          <FormField label="Tipo de conta">
            <NativeSelect
              value={receb.bankAccountType}
              onChange={(v) => set({ bankAccountType: v })}
              options={[
                { value: "corrente", label: "Corrente" },
                { value: "poupanca", label: "Poupança" },
              ]}
            />
          </FormField>
          <FormField label="Titular da conta">
            <Input
              value={receb.bankHolderName}
              onChange={(e) => set({ bankHolderName: e.target.value })}
              maxLength={200}
              placeholder="Se for diferente do comissionado"
            />
          </FormField>
          <FormField label="CPF/CNPJ do titular">
            <Input
              value={receb.bankHolderDoc}
              onChange={(e) => set({ bankHolderDoc: e.target.value })}
              maxLength={18}
              placeholder="000.000.000-00"
            />
          </FormField>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleSave}
          disabled={saving}
          className="text-xs"
        >
          {saving
            ? "Salvando..."
            : preenchido
              ? "Salvar cadastro e dados de recebimento"
              : "Salvar como cadastro reutilizável"}
        </Button>
        {preenchido && (
          <p className="text-xs text-amber-700 dark:text-amber-500">
            Clique em salvar — os dados de recebimento se perdem se você sair
            sem salvar.
          </p>
        )}
      </div>
    </div>
  );
}
