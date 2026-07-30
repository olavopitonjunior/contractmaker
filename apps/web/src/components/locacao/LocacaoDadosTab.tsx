"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GARANTIA_TIPO_LABELS } from "@/lib/locacao/validators";
import { ExternalLink, Home, Receipt, ShieldCheck, User, Users } from "lucide-react";
import {
  PartyLinksPanel,
  type PartyLinksPanelProps,
} from "@/components/forms/PartyLinksPanel";
import { ComissaoLocacaoCard } from "@/components/locacao/ComissaoLocacaoCard";
import type { ComissaoLocacaoValue } from "@/components/locacao/ComissaoLocacaoSection";
import { formPublicPath } from "@/lib/forms/form-url";

interface LocacaoDadosTabProps {
  dealId: string;
  dataJson: Record<string, unknown>;
  formToken: string | null;
  formStatus: string | null;
  dealTitle?: string | null;
}

const BRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Parte = {
  tipo_pessoa?: string;
  nome?: string;
  razao_social?: string;
  cpf?: string;
  cnpj?: string;
  email?: string;
  mobile_phone?: string;
  estado_civil?: string;
  profissao?: string;
  renda_mensal?: number;
  representante?: { nome?: string; cpf?: string };
};

function parteLabel(p: Parte): string {
  return p.nome || p.razao_social || "—";
}

function parteDoc(p: Parte): string | null {
  if (p.cpf) return `CPF ${p.cpf}`;
  if (p.cnpj) return `CNPJ ${p.cnpj}`;
  return null;
}

function ParteRow({ parte }: { parte: Parte }) {
  const doc = parteDoc(parte);
  return (
    <div className="rounded-md border px-3 py-2 text-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium">{parteLabel(parte)}</span>
        {parte.tipo_pessoa === "juridica" && (
          <Badge variant="outline" className="text-[10px]">PJ</Badge>
        )}
        {doc && <span className="text-muted-foreground text-xs">{doc}</span>}
      </div>
      <div className="text-xs text-muted-foreground mt-0.5 flex gap-3 flex-wrap">
        {parte.email && <span>{parte.email}</span>}
        {parte.mobile_phone && <span>{parte.mobile_phone}</span>}
        {parte.profissao && <span>{parte.profissao}</span>}
        {typeof parte.renda_mensal === "number" && parte.renda_mensal > 0 && (
          <span>Renda {BRL(parte.renda_mensal)}</span>
        )}
        {parte.representante?.nome && (
          <span>Rep.: {parte.representante.nome}</span>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm truncate" title={value}>{value}</p>
    </div>
  );
}

/**
 * Aba "Dados" do deal de locação — visão read-only do form.dataJson, paridade
 * com a aba Dados de vendas. Edição é pelo formulário público (link no topo);
 * editor estruturado inline fica como follow-up.
 */
export function LocacaoDadosTab({
  dealId,
  dataJson,
  formToken,
  formStatus,
  dealTitle,
}: LocacaoDadosTabProps) {
  const locadores = (dataJson.locadores as Parte[] | undefined) ?? [];
  const locatarios = (dataJson.locatarios as Parte[] | undefined) ?? [];
  const imovel = (dataJson.imovel ?? {}) as Record<string, unknown>;
  const aluguel = (dataJson.aluguel ?? {}) as Record<string, unknown>;
  const garantia = (dataJson.garantia ?? {}) as Record<string, unknown>;
  const comissao = (dataJson.comissao ?? {}) as Record<string, unknown>;
  const fiscal = (dataJson.fiscal ?? {}) as Record<string, unknown>;

  const enderecoImovel = [imovel.rua, imovel.numero].filter(Boolean).join(", ");
  const cidadeImovel = [imovel.cidade, imovel.uf].filter(Boolean).join("/");
  const valorAluguel = Number(aluguel.valor || 0);
  const fiador = garantia.fiador as Parte | undefined;

  const isEmpty =
    locadores.length === 0 && locatarios.length === 0 && !enderecoImovel && valorAluguel <= 0;

  const partyRoles: PartyLinksPanelProps["roles"] = [
    "locador",
    "locatario",
    ...(garantia.tipo === "fiador" ? (["fiador"] as const) : []),
  ];

  // Comissão é do OPERADOR (não vem do link público) — editável mesmo antes de
  // o cliente preencher qualquer coisa.
  const comissaoCard = (
    <ComissaoLocacaoCard
      dealId={dealId}
      initialValue={comissao as ComissaoLocacaoValue}
      valorAluguel={valorAluguel}
    />
  );

  if (isEmpty) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              Nenhum dado preenchido ainda.{" "}
              {formStatus === "completo"
                ? ""
                : "Os dados aparecem aqui conforme o formulário é preenchido."}
            </p>
            {formToken && (
              <Button variant="outline" size="sm" asChild>
                <a
                  href={formPublicPath(formToken, dealTitle)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-4 w-4 mr-1.5" /> Abrir formulário
                </a>
              </Button>
            )}
          </CardContent>
        </Card>
        {comissaoCard}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <User className="h-4 w-4" /> Locador(es) ({locadores.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {locadores.length === 0 ? (
              <p className="text-sm text-muted-foreground">Não informado.</p>
            ) : (
              locadores.map((p, i) => <ParteRow key={i} parte={p} />)
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" /> Locatário(s) ({locatarios.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {locatarios.length === 0 ? (
              <p className="text-sm text-muted-foreground">Não informado.</p>
            ) : (
              locatarios.map((p, i) => <ParteRow key={i} parte={p} />)
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Home className="h-4 w-4" /> Imóvel
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Endereço" value={enderecoImovel || null} />
            <Field label="Bairro" value={imovel.bairro as string} />
            <Field label="Cidade" value={cidadeImovel || null} />
            <Field label="CEP" value={imovel.cep as string} />
            <Field label="Tipo" value={imovel.kind as string} />
            <Field label="Matrícula" value={imovel.matricula as string} />
            <Field label="Inscrição IPTU" value={imovel.inscricao_iptu as string} />
            <Field
              label="Área"
              value={Number(imovel.area || 0) > 0 ? `${imovel.area} m²` : null}
            />
          </div>
          {typeof imovel.descricao === "string" && imovel.descricao && (
            <p className="text-sm text-muted-foreground mt-3">{imovel.descricao}</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Receipt className="h-4 w-4" /> Aluguel e condições
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label="Aluguel" value={valorAluguel > 0 ? BRL(valorAluguel) : null} />
              <Field
                label="Vencimento"
                value={aluguel.dia_vencimento ? `Dia ${aluguel.dia_vencimento}` : null}
              />
              <Field label="Reajuste" value={aluguel.indice_reajuste as string} />
              <Field label="Início" value={aluguel.vigencia_inicio as string} />
              <Field
                label="Vigência"
                value={aluguel.vigencia_meses ? `${aluguel.vigencia_meses} meses` : null}
              />
              <Field
                label="Taxa adm."
                value={
                  Number(fiscal.taxa_admin_percent ?? aluguel.taxa_admin_percent ?? 0) > 0
                    ? `${fiscal.taxa_admin_percent ?? aluguel.taxa_admin_percent}%`
                    : null
                }
              />
              <Field
                label="Taxa de locação"
                value={
                  Number(comissao.taxa_locacao_percent || 0) > 0
                    ? `${comissao.taxa_locacao_percent}%`
                    : null
                }
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Garantia
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-2 gap-4">
              <Field
                label="Tipo"
                value={
                  (GARANTIA_TIPO_LABELS[(garantia.tipo as string) ?? ""] ??
                    (garantia.tipo as string)) ||
                  null
                }
              />
              <Field label="Provedor" value={garantia.provider as string} />
              <Field
                label="Caução"
                value={
                  Number(garantia.caucao_meses || 0) > 0
                    ? `${garantia.caucao_meses} aluguel(éis)`
                    : null
                }
              />
            </div>
            {fiador && (parteLabel(fiador) !== "—") && (
              <div className="pt-1">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                  Fiador
                </p>
                <ParteRow parte={fiador} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {comissaoCard}

      {formToken && (
        <>
          <PartyLinksPanel
            formToken={formToken}
            roles={partyRoles}
            categoriesModule="locacao"
          />
          <div className="flex justify-end">
            <Button variant="outline" size="sm" asChild>
              <a
                href={formPublicPath(formToken, dealTitle)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-4 w-4 mr-1.5" /> Editar no formulário
              </a>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
