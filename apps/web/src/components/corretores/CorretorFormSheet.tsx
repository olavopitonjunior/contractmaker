"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Save } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  buildCorretorFormSchema,
  EMPTY_CORRETOR_FORM,
  PAPEL_OPTIONS,
  type CorretorFormValues,
} from "./corretor-form-schema";
import { NotifyToggles } from "./NotifyToggles";
import type { Corretor } from "./types";

interface CorretorFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Corretor em edição — null significa criação. */
  editing: Corretor | null;
  pagadoriaEnabled: boolean;
  onSaved: () => void;
}

/**
 * Sheet de criar/editar corretor — RHF + zodResolver, mesmos payloads e
 * semântica de pendingFields do CorretoresClient original (ver `save()`).
 */
export function CorretorFormSheet({
  open,
  onOpenChange,
  editing,
  pagadoriaEnabled,
  onSaved,
}: CorretorFormSheetProps) {
  const isCreate = !editing;

  const form = useForm<CorretorFormValues>({
    // `initial` = valores já gravados do registro em edição: campo intocado com
    // valor legado (soft do form público) não é revalidado — espelha o bypass
    // do PATCH no server, senão o sheet travava em campos que o admin não tocou.
    resolver: zodResolver(
      buildCorretorFormSchema(
        isCreate,
        editing
          ? { cpfCnpj: editing.cpfCnpj, creci: editing.creci, phone: editing.phone }
          : undefined
      )
    ),
    defaultValues: EMPTY_CORRETOR_FORM,
  });

  // Reidrata o form a cada abertura — cadastro novo zera, edição carrega o
  // registro (chave PIX nunca vem pré-preenchida: é write-only no cadastro).
  useEffect(() => {
    if (!open) return;
    form.reset(
      editing
        ? {
            label: editing.label,
            tipoPessoa: editing.tipoPessoa ?? "fisica",
            cpfCnpj: editing.cpfCnpj ?? "",
            creci: editing.creci ?? "",
            papel: (editing.papel as CorretorFormValues["papel"]) ?? "captador",
            email: editing.email ?? "",
            phone: editing.phone ?? "",
            pixAddressKey: "",
            bankName: editing.bankName ?? "",
            bankBranch: editing.bankBranch ?? "",
            bankAccount: editing.bankAccount ?? "",
            bankAccountType:
              (editing.bankAccountType as CorretorFormValues["bankAccountType"]) ??
              "corrente",
            bankHolderName: editing.bankHolderName ?? "",
            bankHolderDoc: editing.bankHolderDoc ?? "",
            notifyByEmail: editing.notifyByEmail,
            notifyByWhatsapp: editing.notifyByWhatsapp,
            notifyOptOut: editing.notifyOptOut,
            maxEnabled: editing.maxEnabled,
          }
        : EMPTY_CORRETOR_FORM
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  async function onSubmit(values: CorretorFormValues) {
    const common = {
      label: values.label.trim(),
      cpfCnpj: values.cpfCnpj.trim() || null,
      tipoPessoa: values.tipoPessoa,
      creci: values.creci.trim() || null,
      papel: values.papel || null,
      email: values.email.trim() || null,
      phone: values.phone.trim() || null,
      bankName: values.bankName.trim() || null,
      bankBranch: values.bankBranch.trim() || null,
      bankAccount: values.bankAccount.trim() || null,
      bankAccountType: values.bankAccount.trim() ? values.bankAccountType : null,
      bankHolderName: values.bankHolderName.trim() || null,
      bankHolderDoc: values.bankHolderDoc.trim() || null,
      notifyByEmail: values.notifyByEmail,
      notifyByWhatsapp: values.notifyByWhatsapp,
      notifyOptOut: values.notifyOptOut,
      maxEnabled: values.maxEnabled,
    };

    let url = "/api/financeiro/split-recipients";
    let method = "POST";
    let payload: Record<string, unknown>;
    if (editing) {
      url = `/api/financeiro/split-recipients/${editing.id}`;
      method = "PATCH";
      payload = common;
    } else if (values.pixAddressKey.trim()) {
      payload = {
        ...common,
        kind: "commissioner",
        recipientType: "pix_external",
        pixAddressKey: values.pixAddressKey.trim(),
        ownerName: values.label.trim(),
        ownerCpfCnpj: values.cpfCnpj.trim(),
      };
    } else {
      // Sem meio de recebimento: rascunho (pendingFields) — o corretor pode
      // completar depois via magic link ("Pedir dados") ou o admin edita.
      payload = {
        ...common,
        kind: "commissioner",
        recipientType: "asaas_wallet",
        pendingFields: ["walletId"],
      };
    }

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Falha ao salvar");
      return;
    }
    toast.success(editing ? "Corretor atualizado" : "Corretor cadastrado");
    onOpenChange(false);
    onSaved();
  }

  const tipoPessoa = form.watch("tipoPessoa");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{editing ? "Editar corretor" : "Novo corretor"}</SheetTitle>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4">
            <FormField
              control={form.control}
              name="label"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Nome do corretor ou razão social"
                      maxLength={120}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="tipoPessoa"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo</FormLabel>
                    <div className="grid grid-cols-2 gap-1 mt-1">
                      {(["fisica", "juridica"] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => field.onChange(t)}
                          className={cn(
                            "rounded-md border p-2 text-xs transition-colors",
                            field.value === t
                              ? "border-primary bg-primary/5 font-medium text-foreground"
                              : "border-input text-muted-foreground hover:bg-accent"
                          )}
                        >
                          {t === "fisica" ? "Pessoa física" : "Pessoa jurídica"}
                        </button>
                      ))}
                    </div>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="cpfCnpj"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {tipoPessoa === "juridica" ? "CNPJ" : "CPF"} {isCreate ? "*" : ""}
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="Apenas números" maxLength={18} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="creci"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CRECI</FormLabel>
                    <FormControl>
                      <Input maxLength={50} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="papel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Papel</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PAPEL_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" maxLength={200} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>WhatsApp / telefone</FormLabel>
                    <FormControl>
                      <Input placeholder="+55 11 91234-5678" maxLength={30} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="border rounded-md p-3 space-y-3">
              <div className="text-sm font-medium">Notificações do processo</div>
              <NotifyToggles
                notifyByEmail={form.watch("notifyByEmail")}
                notifyByWhatsapp={form.watch("notifyByWhatsapp")}
                notifyOptOut={form.watch("notifyOptOut")}
                hasEmail={form.watch("email").trim() !== ""}
                hasPhone={form.watch("phone").trim() !== ""}
                onChange={(patch) => {
                  if (patch.notifyByEmail !== undefined) {
                    form.setValue("notifyByEmail", patch.notifyByEmail, { shouldDirty: true });
                  }
                  if (patch.notifyByWhatsapp !== undefined) {
                    form.setValue("notifyByWhatsapp", patch.notifyByWhatsapp, {
                      shouldDirty: true,
                    });
                  }
                  if (patch.notifyOptOut !== undefined) {
                    form.setValue("notifyOptOut", patch.notifyOptOut, { shouldDirty: true });
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">
                Quais eventos disparam atualização é definido no padrão da
                imobiliária e por venda; aqui é a preferência do corretor.
              </p>
            </div>

            {/* Bloco PRÓPRIO, e não mais um switch dentro de "Notificações":
                as duas coisas se parecem e não são a mesma. Ver o texto de
                apoio abaixo — ele existe para impedir a marcação por engano. */}
            <div className="border rounded-md p-3 space-y-3">
              <div className="text-sm font-medium">Agente Max (WhatsApp)</div>
              <FormField
                control={form.control}
                name="maxEnabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-3 space-y-0">
                    <FormLabel className="font-normal">
                      Corretor da casa — pode conversar com o Max
                    </FormLabel>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <p className="text-xs text-muted-foreground">
                Não é o mesmo que receber notificação: um corretor de
                imobiliária parceira pode receber avisos de uma venda
                compartilhada sem ser da sua casa. Ligado, o Max reconhece o
                telefone dele como seu e responde sobre as vendas em que ele é
                comissionado — só essas.
              </p>
            </div>

            {/* SEMPRE visível na criação (mesmo com a lente de pagadoria
                desligada): sem chave o cadastro nasce rascunho active:false, e
                active:true é o que o Max (broker-scope) e o combobox do form
                público filtram — esconder o campo deixava o registro travado
                sem nenhum caminho de ativação (achado do code review). */}
            {isCreate && (
              <FormField
                control={form.control}
                name="pixAddressKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Chave PIX (recebimento — opcional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="CPF, CNPJ, email, telefone ou chave aleatória"
                        {...field}
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground mt-1">
                      Sem chave PIX o cadastro fica com dados de recebimento
                      pendentes — dá pra pedir depois pelo botão &quot;Pedir dados&quot;.
                    </p>
                  </FormItem>
                )}
              />
            )}

            {pagadoriaEnabled && (
              <div className="border rounded-md p-3 space-y-3">
                <div className="text-sm font-medium">Dados bancários (TED — opcional)</div>
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="bankName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Banco</FormLabel>
                        <FormControl>
                          <Input maxLength={80} {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="bankBranch"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Agência</FormLabel>
                        <FormControl>
                          <Input maxLength={20} {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="bankAccount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Conta</FormLabel>
                        <FormControl>
                          <Input maxLength={30} {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="bankAccountType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tipo</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="corrente">Corrente</SelectItem>
                            <SelectItem value="poupanca">Poupança</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="bankHolderName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Titular</FormLabel>
                        <FormControl>
                          <Input maxLength={200} {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="bankHolderDoc"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>CPF/CNPJ do titular</FormLabel>
                        <FormControl>
                          <Input maxLength={18} {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                <Save className="h-4 w-4 mr-1" />
                {form.formState.isSubmitting ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
