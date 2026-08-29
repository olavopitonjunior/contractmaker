"use client";

import { useEffect, useId, useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { summarizeCompletion } from "@/components/corretores/completion-toast";
import { DuplicataCorretorDialog } from "@/components/corretores/DuplicataCorretorDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Landmark, Mail } from "lucide-react";
import { NativeSelect } from "@/components/forms/NativeSelect";
import { temRecebimento } from "@/lib/forms/commissioner-receiving";
import { useComissionadoRegistry } from "@/components/forms/steps/useComissionadoRegistry";

function FormField({
  label,
  children,
  className = "",
}: {
  label: React.ReactNode;
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

/**
 * Dados bancários do comissionado e o cadastro dele no roster da imobiliária.
 * Compartilhado entre o form de VENDA (`comissao.comissionados[i]`) e o de
 * LOCAÇÃO (`comissao.angariadores[i]`) — os campos de qualificação têm os
 * mesmos nomes nos dois schemas.
 *
 * Duas mudanças de 08/2026, e as duas vieram do uso real:
 *
 *  - **Os campos vivem no react-hook-form**, em `${basePath}.recebimento.*`, e
 *    portanto no `dataJson`. Antes eram estado local write-only, para não
 *    trafegar PII bancária no GET público; agora o dado fica salvo no
 *    formulário (produto: quem preenche reabre e encontra o que digitou) e a
 *    proteção passou a ser a redação por leitor no servidor
 *    (`lib/forms/redact-datajson.ts`), aplicada em toda superfície de leitura,
 *    mais a ausência no resumo.
 *  - **Não há botão de salvar.** O cadastro é criado sozinho quando a linha
 *    tem nome e algum identificador, com o diálogo "é a mesma pessoa?" quando o
 *    servidor reconhece alguém — ver `useComissionadoRegistry`. O botão antigo
 *    ("Salvar como cadastro reutilizável") era um passo que ninguém dava, e sem
 *    ele o corretor não entrava no roster.
 *
 * Cadastro já vinculado: membro ganha "Pedir dados ao corretor", que reusa o
 * magic link de completion — o corretor preenche num link próprio, por e-mail.
 */
export function CadastroRecebimento({
  form,
  basePath,
  endpoint,
  papelDefault,
  showReceiving,
  required = false,
}: {
  form: UseFormReturn<any>;
  /** Prefixo RHF da linha, ex. `comissao.comissionados.0`. */
  basePath: string;
  /** POST de cadastro, ex. `/api/forms/<token>/commissioners`. */
  endpoint: string;
  /** Papel enviado quando a linha não tem campo próprio (locação = captador). */
  papelDefault: string;
  /** Visitante é membro da imobiliária — só então os campos aparecem. */
  showReceiving: boolean;
  /**
   * A imobiliária exige estes dados para concluir a etapa
   * (OrgFormSettings.requireCommissionerReceiving). Abre o bloco e marca os
   * campos — o padrão fechado escondia o passo de quem precisava dele.
   */
  required?: boolean;
}) {
  const [requesting, setRequesting] = useState(false);
  // Exigido = sempre aberto, sem botão de mostrar/ocultar: um bloco recolhido
  // atrás de um botão discreto era o motivo de o passo passar despercebido.
  const [open, setOpen] = useState(required);
  useEffect(() => {
    if (required) setOpen(true);
  }, [required]);
  const fieldId = useId();

  const splitRecipientId = form.watch(`${basePath}.splitRecipientId`) as
    | string
    | undefined;
  const recebimento = form.watch(`${basePath}.recebimento`) as
    | Record<string, string | undefined>
    | undefined;
  // Os campos de IDENTIFICAÇÃO ficam nas etapas (venda e locação desenham a
  // linha de formas diferentes), mas é a mudança deles que dispara o
  // reconhecimento. Observar aqui evita ter de pendurar um `onBlur` em cada
  // input das duas telas — e esquecer um deles seria uma linha que nunca vira
  // cadastro, que é exatamente o defeito que este fluxo veio corrigir.
  const nome = form.watch(`${basePath}.nome`);
  const cpf = form.watch(`${basePath}.cpf`);
  const cnpj = form.watch(`${basePath}.cnpj`);
  const email = form.watch(`${basePath}.email`);
  const telefone = form.watch(`${basePath}.mobile_phone`);

  const registry = useComissionadoRegistry({
    form,
    basePath,
    endpoint,
    matchEndpoint: `${endpoint}/match`,
    papelDefault,
    viewerIsMember: showReceiving,
  });

  // Reidrata linha antiga (dados só no cadastro), reconhece duplicata e cria o
  // que faltar. O hook decide o que fazer; aqui só se diz "os campos mudaram".
  // O debounce espera a digitação parar; o hook ainda ignora repetição da mesma
  // identidade, então rodar de novo à toa não gera request.
  const { avaliar } = registry;
  useEffect(() => {
    const t = setTimeout(() => void avaliar(), 900);
    return () => clearTimeout(t);
  }, [avaliar, nome, cpf, cnpj, email, telefone, splitRecipientId]);

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
      const { message, anySent } = summarizeCompletion(body);
      if (anySent) {
        toast.success(
          `Pedido enviado — ${message}. O corretor preenche os dados num link seguro.`
        );
      } else {
        toast.error(message);
      }
    } catch (err) {
      console.error("[CadastroRecebimento request-completion]", err);
      toast.error("Erro ao enviar o pedido.");
    } finally {
      setRequesting(false);
    }
  };

  // Cliente com o link não vê nem envia estes campos: o servidor os redige na
  // leitura e os recusa na escrita, então mostrá-los seria pedir dado bancário
  // de terceiro a quem não tem o que fazer com ele.
  if (!showReceiving) {
    return (
      <p className="pt-2 border-t border-dashed text-xs text-muted-foreground">
        Os dados bancários deste corretor são mantidos pela imobiliária.
      </p>
    );
  }

  const completo = temRecebimento(recebimento ?? null);
  const marca = required ? <span className="text-primary"> *</span> : null;

  return (
    <div className="pt-2 border-t border-dashed space-y-3">
      <DuplicataCorretorDialog
        candidato={registry.candidato}
        onConfirmar={registry.confirmarMesmaPessoa}
        onNegar={registry.negarMesmaPessoa}
      />

      <div
        className={
          required && !completo
            ? "flex items-center justify-between flex-wrap gap-2 rounded-md border border-primary/40 bg-primary/5 p-3"
            : "flex items-center justify-between flex-wrap gap-2"
        }
      >
        <div>
          <p className="text-sm font-semibold flex items-center gap-1.5">
            <Landmark className="h-4 w-4" /> Dados bancários do corretor
            {required && (
              <span className="text-xs font-normal text-primary">· obrigatório</span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {required
              ? "Informe a chave PIX ou os dados da conta. Ficam salvos no formulário e no cadastro do corretor — não aparecem no resumo nem para quem mais tiver o link."
              : "Ficam salvos no formulário e no cadastro do corretor — não aparecem no resumo nem para quem mais tiver o link."}
          </p>
        </div>
        {!required && (
          <Button
            type="button"
            size="sm"
            variant={open ? "ghost" : "default"}
            onClick={() => setOpen((v) => !v)}
          >
            <Landmark className="h-3.5 w-3.5 mr-1.5" />
            {open ? "Ocultar" : "Preencher dados bancários"}
          </Button>
        )}
        {splitRecipientId && (
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
        )}
      </div>

      {open && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-md border border-dashed bg-background/60 p-3">
          <FormField label={<>Chave PIX{marca}</>} className="md:col-span-2">
            <Input
              id={`${fieldId}-pix`}
              {...form.register(`${basePath}.recebimento.pix_chave`)}
              onBlur={() => void registry.avaliar()}
              maxLength={200}
              placeholder="CPF, CNPJ, e-mail, telefone ou chave aleatória"
            />
            <p className="text-xs text-muted-foreground">
              Se preferir, deixe em branco e informe a conta bancária abaixo —
              qualquer um dos dois atende.
            </p>
          </FormField>

          <FormField label={<>Banco{marca}</>}>
            <Input
              {...form.register(`${basePath}.recebimento.banco`)}
              maxLength={80}
              placeholder="Ex: Itaú"
            />
          </FormField>
          <FormField label={<>Agência{marca}</>}>
            <Input
              {...form.register(`${basePath}.recebimento.agencia`)}
              maxLength={20}
              placeholder="0000"
            />
          </FormField>
          <FormField label={<>Conta{marca}</>}>
            <Input
              {...form.register(`${basePath}.recebimento.conta`)}
              maxLength={30}
              placeholder="00000-0"
            />
          </FormField>
          <FormField label={<>Tipo de conta{marca}</>}>
            <NativeSelect
              value={recebimento?.tipo_conta ?? ""}
              onChange={(v) =>
                form.setValue(`${basePath}.recebimento.tipo_conta`, v || undefined, {
                  shouldDirty: true,
                })
              }
              options={[
                { value: "", label: "Selecione..." },
                { value: "corrente", label: "Corrente" },
                { value: "poupanca", label: "Poupança" },
              ]}
            />
          </FormField>
          <FormField label="Titular da conta">
            <Input
              {...form.register(`${basePath}.recebimento.titular_nome`)}
              maxLength={200}
              placeholder="Se for diferente do comissionado"
            />
          </FormField>
          <FormField label="CPF/CNPJ do titular">
            <Input
              {...form.register(`${basePath}.recebimento.titular_doc`)}
              maxLength={18}
              placeholder="000.000.000-00"
            />
          </FormField>

          {required && !completo && (
            <p className="md:col-span-2 text-xs text-amber-700 dark:text-amber-500">
              Falta a chave PIX ou os quatro campos da conta (banco, agência,
              conta e tipo).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
