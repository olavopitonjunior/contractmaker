"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { MoneyInput } from "@/components/forms/MoneyInput";
import { NativeSelect } from "@/components/forms/NativeSelect";
import { maskCPF, maskCNPJ, maskTelefone } from "@/lib/forms/field-formats";
import { formatMoneyBR } from "@/lib/format/money";
import {
  angariadorValorMensal,
  angariadorValorTotal,
  formaComissao,
  rateioPrimeiroAluguel,
  somaPercentuaisAngariadores,
  taxaLocacaoEfetiva,
} from "@/lib/locacao/commission";
import { Building2, Trash2, UserPlus } from "lucide-react";

/**
 * Seção de COMISSÃO da locação — superfície do OPERADOR (não do cliente que
 * preenche o link público, que nunca negocia comissão: ver ROLE_PATHS, onde
 * `comissao` fica fora de locador/locatario/fiador).
 *
 * Montada em dois lugares com o mesmo componente:
 *  - `NovoFormularioLocacaoDialog` (criação do link, estado local);
 *  - aba Dados do deal de locação (`ComissaoLocacaoCard`, que persiste via
 *    PATCH /api/locacao/deals/[dealId]/comissao).
 *
 * Controlado (value/onChange) em vez de react-hook-form de propósito: o diálogo
 * de criação não tem RHF, e o card do deal precisa de dirty-tracking próprio.
 *
 * TODO(follow-up): dados de recebimento (PIX/banco) write-only como no passo de
 * comissão de venda — depende de um endpoint de commissioners pra locação
 * (o de venda é `/api/forms/[token]/commissioners`, amarrado ao token público).
 */

export interface AngariadorValue {
  splitRecipientId?: string;
  nome?: string;
  tipo_pessoa?: "fisica" | "juridica";
  cpf?: string;
  cnpj?: string;
  creci?: string;
  email?: string;
  mobile_phone?: string;
  forma_comissao?: "percentual" | "valor_fixo";
  percentual?: number;
  valor_fixo?: number;
  meses_comissao?: number;
  /** Parte deste corretor no PRIMEIRO aluguel (cláusula de rateio). */
  valor_primeiro_aluguel?: number;
}

export interface ComissaoLocacaoValue {
  /** `percentual` (default) ou `valor_fixo` — espelha o form público. */
  forma_taxa_locacao?: "percentual" | "valor_fixo";
  taxa_locacao_percent?: number;
  taxa_locacao_valor?: number;
  angariadores?: AngariadorValue[];
}

interface ComissaoLocacaoSectionProps {
  value: ComissaoLocacaoValue;
  onChange: (next: ComissaoLocacaoValue) => void;
  /** Aluguel mensal (dataJson.aluguel.valor) — habilita os previews em R$. */
  valorAluguel?: number;
  disabled?: boolean;
}

// Formatação determinística (lib/format/money.ts), NÃO `toLocaleString` com
// `style: "currency"`: o ICU intercala um espaço não-quebrável entre símbolo e
// número cuja forma varia por versão (U+00A0 × U+202F), e o ICU do Node da
// Vercel não é o do browser. Como o `ComissaoLocacaoCard` é renderizado no
// servidor na aba Dados do deal, essa diferença aparecia no primeiro paint e
// quebrava a hidratação (React #418). Mesma saída visual: "R$ 1.500,00".
const BRL = (v: number) => formatMoneyBR(v);

/** Number ou undefined a partir do input (string vazia não vira 0). */
function toNumberOrUndefined(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

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

export function ComissaoLocacaoSection({
  value,
  onChange,
  valorAluguel = 0,
  disabled = false,
}: ComissaoLocacaoSectionProps) {
  const uid = useId();
  const angariadores = value.angariadores ?? [];
  const formaTaxa =
    value.forma_taxa_locacao === "valor_fixo" ? "valor_fixo" : "percentual";
  const corretagem = taxaLocacaoEfetiva(valorAluguel, value);
  const somaPercentuais = somaPercentuaisAngariadores(angariadores);
  // Rateio do 1º aluguel: os corretores recebem de DENTRO da taxa, então a
  // parte da imobiliária é a taxa menos a soma deles. Sem este aviso, um erro
  // de digitação no valor de um corretor zera a comissão da própria imobiliária
  // e a cláusula sai do contrato sem ela — sem "R$ 0,00", sem linha, sem sinal.
  const rateio = rateioPrimeiroAluguel(valorAluguel, value);

  const patchAngariador = (index: number, patch: Partial<AngariadorValue>) => {
    const next = angariadores.map((a, i) => (i === index ? { ...a, ...patch } : a));
    onChange({ ...value, angariadores: next });
  };

  const addAngariador = (tipo: "fisica" | "juridica") => {
    onChange({
      ...value,
      angariadores: [
        ...angariadores,
        {
          nome: "",
          tipo_pessoa: tipo,
          cpf: "",
          cnpj: "",
          creci: "",
          email: "",
          mobile_phone: "",
          forma_comissao: "percentual",
        },
      ],
    });
  };

  const removeAngariador = (index: number) => {
    onChange({
      ...value,
      angariadores: angariadores.filter((_, i) => i !== index),
    });
  };

  return (
    <div className="space-y-4">
      {/* Corretagem — one-shot sobre o 1º aluguel */}
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground">
          Comissão de corretagem (taxa de locação)
        </p>
        <p className="text-xs text-muted-foreground">
          Devida à imobiliária pela intermediação, cobrada uma única vez sobre o
          PRIMEIRO aluguel. Entra na cláusula de remuneração do contrato de
          administração.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* A forma tem que existir AQUI também: o cliente pode ter escolhido
              valor fixo na etapa Comissão do formulário, e uma tela que só sabe
              ler percentual mostraria a comissão dele como 0%. */}
          <FormField label="Cobrada como">
            <NativeSelect
              value={formaTaxa}
              disabled={disabled}
              onChange={(v) =>
                onChange({
                  ...value,
                  forma_taxa_locacao: v === "valor_fixo" ? "valor_fixo" : "percentual",
                })
              }
              options={[
                { value: "percentual", label: "% do primeiro aluguel" },
                { value: "valor_fixo", label: "Valor fixo (R$)" },
              ]}
            />
          </FormField>
          {formaTaxa === "valor_fixo" ? (
            <FormField label="Valor da taxa (R$)">
              <Input
                id={`${uid}-taxa-valor`}
                type="number"
                min="0"
                step="0.01"
                disabled={disabled}
                value={value.taxa_locacao_valor ?? ""}
                onChange={(e) =>
                  onChange({
                    ...value,
                    taxa_locacao_valor: toNumberOrUndefined(e.target.value),
                  })
                }
                placeholder="Ex: 800"
              />
            </FormField>
          ) : (
            <FormField label="Taxa de locação (%)">
              <Input
                id={`${uid}-taxa`}
                type="number"
                min="0"
                max="100"
                step="0.01"
                disabled={disabled}
                value={value.taxa_locacao_percent ?? ""}
                onChange={(e) =>
                  onChange({
                    ...value,
                    taxa_locacao_percent: toNumberOrUndefined(e.target.value),
                  })
                }
                placeholder="Ex: 100 (um aluguel)"
              />
            </FormField>
          )}
          {formaTaxa === "percentual" && corretagem > 0 && (
            <div className="flex flex-col justify-end pb-1">
              <p className="text-sm">
                <span className="text-muted-foreground">Equivale a </span>
                <strong>{BRL(corretagem)}</strong>
              </p>
              <p className="text-xs text-muted-foreground">
                sobre o aluguel de {BRL(valorAluguel)}.
              </p>
            </div>
          )}
        </div>
      </div>

      <Separator />

      {/* Angariadores — comissão recorrente */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm font-semibold text-foreground">
          Corretores angariadores (comissão recorrente)
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => addAngariador("fisica")}
          >
            <UserPlus className="h-3.5 w-3.5 mr-1.5" />
            Novo corretor (PF)
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => addAngariador("juridica")}
          >
            <Building2 className="h-3.5 w-3.5 mr-1.5" />
            Nova imobiliária (PJ)
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        Quem captou o imóvel recebe TODO MÊS — por percentual do aluguel ou valor
        fixo — enquanto durar a comissão. Diferente da corretagem acima, que é
        paga uma vez só.
      </p>

      {angariadores.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-md border border-dashed p-3">
          Nenhum angariador cadastrado. A comissão recorrente é opcional.
        </p>
      ) : (
        angariadores.map((a, index) => {
          const isPF = (a.tipo_pessoa ?? "fisica") === "fisica";
          const forma = formaComissao(a);
          const mensal = angariadorValorMensal(a, valorAluguel);
          const total = angariadorValorTotal(a, valorAluguel);
          return (
            <div
              key={index}
              className="rounded-md border p-4 space-y-3 bg-muted/20"
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">
                    {index === 0 ? "Angariador principal" : `Angariador ${index + 1}`}
                  </p>
                  {a.splitRecipientId && (
                    <span className="inline-flex items-center rounded-full border border-green-300 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300">
                      Cadastro vinculado
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  className="h-7 text-xs text-destructive hover:text-destructive"
                  onClick={() => removeAngariador(index)}
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  Remover
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="Tipo de cadastro" className="md:col-span-2">
                  <NativeSelect
                    value={a.tipo_pessoa ?? "fisica"}
                    disabled={disabled}
                    onChange={(v) =>
                      patchAngariador(index, {
                        tipo_pessoa: v === "juridica" ? "juridica" : "fisica",
                      })
                    }
                    options={[
                      { value: "fisica", label: "Corretor autônomo (PF)" },
                      { value: "juridica", label: "Imobiliária (PJ)" },
                    ]}
                  />
                </FormField>

                <FormField
                  label={isPF ? "Nome do corretor" : "Nome da imobiliária"}
                  className="md:col-span-2"
                >
                  <Input
                    disabled={disabled}
                    value={a.nome ?? ""}
                    onChange={(e) => patchAngariador(index, { nome: e.target.value })}
                    placeholder={
                      isPF ? "Nome completo" : "Razão Social ou Nome Fantasia"
                    }
                  />
                </FormField>

                {isPF ? (
                  <FormField label="CPF do corretor">
                    <Input
                      disabled={disabled}
                      inputMode="numeric"
                      value={a.cpf ?? ""}
                      onChange={(e) =>
                        patchAngariador(index, { cpf: maskCPF(e.target.value) })
                      }
                      placeholder="000.000.000-00"
                    />
                  </FormField>
                ) : (
                  <FormField label="CNPJ da imobiliária">
                    <Input
                      disabled={disabled}
                      inputMode="numeric"
                      value={a.cnpj ?? ""}
                      onChange={(e) =>
                        patchAngariador(index, { cnpj: maskCNPJ(e.target.value) })
                      }
                      placeholder="00.000.000/0000-00"
                    />
                  </FormField>
                )}

                <FormField label="CRECI">
                  <Input
                    disabled={disabled}
                    value={a.creci ?? ""}
                    onChange={(e) => patchAngariador(index, { creci: e.target.value })}
                    placeholder={isPF ? "Ex: 199.905" : "Ex: J-12345"}
                  />
                </FormField>

                <FormField label="E-mail (notificações e repasse)">
                  <Input
                    type="email"
                    disabled={disabled}
                    value={a.email ?? ""}
                    onChange={(e) => patchAngariador(index, { email: e.target.value })}
                    placeholder="corretor@imobiliaria.com"
                  />
                </FormField>

                <FormField label="Celular (com DDD)">
                  <Input
                    type="tel"
                    inputMode="numeric"
                    disabled={disabled}
                    value={a.mobile_phone ?? ""}
                    onChange={(e) =>
                      patchAngariador(index, {
                        mobile_phone: maskTelefone(e.target.value),
                      })
                    }
                    placeholder="(11) 99999-9999"
                  />
                </FormField>

                <FormField label="Forma da comissão">
                  <NativeSelect
                    value={forma}
                    disabled={disabled}
                    onChange={(v) =>
                      patchAngariador(index, {
                        forma_comissao: v === "valor_fixo" ? "valor_fixo" : "percentual",
                      })
                    }
                    options={[
                      { value: "percentual", label: "Percentual do aluguel" },
                      { value: "valor_fixo", label: "Valor fixo por mês" },
                    ]}
                  />
                </FormField>

                {forma === "percentual" ? (
                  <FormField label="Percentual do aluguel (%)">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      disabled={disabled}
                      value={a.percentual ?? ""}
                      onChange={(e) =>
                        patchAngariador(index, {
                          percentual: toNumberOrUndefined(e.target.value),
                        })
                      }
                      placeholder="Ex: 10"
                    />
                  </FormField>
                ) : (
                  <FormField label="Valor fixo por mês">
                    <MoneyInput
                      value={a.valor_fixo ?? 0}
                      onChange={(v) => patchAngariador(index, { valor_fixo: v })}
                      placeholder="Ex: 150,00"
                    />
                  </FormField>
                )}

                <FormField label="Meses de comissão">
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    disabled={disabled}
                    value={a.meses_comissao ?? ""}
                    onChange={(e) =>
                      patchAngariador(index, {
                        meses_comissao: toNumberOrUndefined(e.target.value),
                      })
                    }
                    placeholder="Vazio = todo o contrato"
                  />
                </FormField>

                {/* Parte do 1º aluguel: é o que a cláusula de rateio imprime no
                    contrato, e sai de DENTRO da taxa da imobiliária. Vazio usa
                    a comissão do mês 1, que é o caso comum — o campo existe
                    para o negócio em que o combinado do primeiro aluguel é
                    outro (metade, valor cheio, um adiantamento). */}
                <FormField label="Parte do 1º aluguel (R$)">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={disabled}
                    value={a.valor_primeiro_aluguel ?? ""}
                    onChange={(e) =>
                      patchAngariador(index, {
                        valor_primeiro_aluguel: toNumberOrUndefined(e.target.value),
                      })
                    }
                    placeholder={mensal > 0 ? `Vazio = ${BRL(mensal)}` : "Vazio = comissão do mês 1"}
                  />
                </FormField>
              </div>

              {mensal > 0 && (
                <p className="text-xs text-muted-foreground">
                  <strong>{BRL(mensal)}</strong>/mês
                  {total === null
                    ? " por todo o contrato."
                    : ` · total de ${BRL(total)}.`}
                </p>
              )}
            </div>
          );
        })
      )}

      {somaPercentuais > 100 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          Soma dos percentuais dos angariadores: <strong>{somaPercentuais.toFixed(2)}%</strong> —
          excede 100% do aluguel.
        </div>
      )}

      {rateio.excede && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          As partes dos corretores no <strong>1º aluguel</strong> somam mais que a taxa de
          intermediação. Do jeito que está, a comissão da imobiliária fica em{" "}
          <strong>R$ 0,00</strong> e ela sai da cláusula de rateio do contrato.
        </div>
      )}
    </div>
  );
}
