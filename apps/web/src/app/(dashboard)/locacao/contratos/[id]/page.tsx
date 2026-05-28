import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, AlertCircle, Building2, User } from "lucide-react";
import { LeaseHeaderActions } from "@/components/locacao/LeaseHeaderActions";
import { NovaCobrancaExtraDialog } from "@/components/locacao/NovaCobrancaExtraDialog";

export const dynamic = "force-dynamic";

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const STATUS_TONE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  rascunho: "outline",
  assinatura: "secondary",
  ativo: "default",
  renovacao: "secondary",
  rescisao: "destructive",
  encerrado: "outline",
};

const REGIME_IR_LABEL: Record<string, string> = {
  nao_retem: "Não retém",
  retem_sem_controle: "Retém (sem controle)",
  retem_imobiliaria: "Retém, imobiliária recolhe",
  retem_inquilino: "Retém, inquilino recolhe",
};

const REPASSE_GARANTIDO_LABEL: Record<string, string> = {
  nao: "Não",
  alguns_meses: "Por alguns meses",
  todo_contrato: "Por todo o contrato",
};

interface Params {
  params: Promise<{ id: string }>;
}

export default async function LeaseContractDetailPage({ params }: Params) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");
  const { id } = await params;

  const lc = await prisma.leaseContract.findFirst({
    where: { id, orgId: org.id },
    include: {
      property: {
        include: { ownerships: { include: { owner: { select: { nome: true } } } } },
      },
      tenants: { include: { tenant: { select: { id: true, nome: true, cpfCnpj: true } } } },
      angariadores: { include: { party: { select: { nome: true } } } },
      guarantee: true,
      rentCharges: {
        orderBy: { dueDate: "desc" },
        take: 12,
      },
      expenses: {
        orderBy: { dueDate: "desc" },
        take: 12,
      },
      checklists: true,
      debtAgreements: true,
      insurancePolicies: true,
      maintenances: { orderBy: { abertaEm: "desc" }, take: 10 },
    },
  });
  if (!lc) notFound();

  const templates = await prisma.checklistTemplate.findMany({
    where: { orgId: org.id, ativo: true },
    select: { id: true, nome: true },
    orderBy: { nome: "asc" },
  });

  const endereco = lc.property
    ? [
        [lc.property.rua, lc.property.numero].filter(Boolean).join(", "),
        lc.property.bairro,
        [lc.property.cidade, lc.property.uf].filter(Boolean).join("/"),
      ]
        .filter(Boolean)
        .join(" · ")
    : "—";

  const cobrancasVencidas = lc.rentCharges.filter((c) => c.status === "atrasada").length;
  const repassesPendentes = lc.rentCharges.filter(
    (c) => c.status === "paga" && !c.repasseTransferId
  ).length;
  const checklistsPendentes = lc.checklists.filter((c) => c.status !== "concluido").length;

  return (
    <div className="space-y-4">
      <Link
        href="/locacao/contratos"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar para contratos
      </Link>

      {/* Header (espelha Superlógica §4.2) */}
      <Card className={lc.status === "rescisao" ? "border-destructive" : ""}>
        <CardContent className="flex flex-wrap items-start justify-between gap-3 py-4">
          <div>
            <h2 className="text-2xl font-semibold">
              Contrato de Locação {lc.finalidade !== "residencial" ? `(${lc.finalidade})` : "Residencial"}
            </h2>
            <p className="text-sm text-muted-foreground">
              De {lc.vigenciaInicio?.toLocaleDateString("pt-BR") ?? "—"} a{" "}
              {lc.vigenciaFim?.toLocaleDateString("pt-BR") ?? "indeterminado"} · vencimento dia{" "}
              {lc.diaVencimento}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge variant={STATUS_TONE[lc.status] ?? "outline"} className="text-sm">
              {lc.status}
            </Badge>
            <LeaseHeaderActions leaseId={lc.id} templates={templates} />
          </div>
        </CardContent>
      </Card>

      {/* Alertas */}
      {(cobrancasVencidas > 0 || repassesPendentes > 0 || checklistsPendentes > 0) && (
        <div className="flex flex-wrap gap-2">
          {cobrancasVencidas > 0 && (
            <Badge variant="destructive" className="gap-1">
              <AlertCircle className="h-3 w-3" /> {cobrancasVencidas} cobrança(s) vencida(s)
            </Badge>
          )}
          {repassesPendentes > 0 && (
            <Badge variant="outline" className="gap-1">
              <AlertCircle className="h-3 w-3" /> {repassesPendentes} repasse(s) pendente(s)
            </Badge>
          )}
          {checklistsPendentes > 0 && (
            <Badge variant="outline" className="gap-1">
              <AlertCircle className="h-3 w-3" /> {checklistsPendentes} checklist(s) pendente(s)
            </Badge>
          )}
        </div>
      )}

      {/* Bloco principal: Contrato + Partes */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contrato</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <Field
              label="Imóvel"
              value={
                lc.property ? (
                  <Link href={`/locacao/imoveis/${lc.propertyId}`} className="text-primary hover:underline">
                    <Building2 className="mr-1 inline h-3.5 w-3.5" />
                    {endereco}
                  </Link>
                ) : (
                  "—"
                )
              }
              className="col-span-2"
            />
            <Field label="Aluguel" value={`${fmtBRL(lc.valorAluguel)} (${lc.regimeCobranca === "mes_vencido" ? "mês vencido" : "mês a vencer"})`} />
            <Field label="Encargos" value={fmtBRL(lc.valorEncargos)} />
            <Field label="Taxa adm" value={`${lc.taxaAdminPercent}%`} />
            <Field label="Índice reajuste" value={lc.indiceReajuste} />
            <Field label="Regime IR" value={REGIME_IR_LABEL[lc.regimeIr] ?? lc.regimeIr} />
            <Field label="Emite NFS-e" value={lc.emitirNfse ? "Sim" : "Não"} />
            <Field
              label="Repasse"
              value={`Dia ${lc.repasseDia ?? "—"} (${lc.repasseTipo.replace(/_/g, " ")})`}
            />
            <Field
              label="Repasse garantido"
              value={`${REPASSE_GARANTIDO_LABEL[lc.repasseGarantido]}${
                lc.repasseGarantidoMeses ? ` (${lc.repasseGarantidoMeses} meses)` : ""
              }`}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Partes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                Locadores ({lc.property?.ownerships.length ?? 0})
              </div>
              {lc.property?.ownerships.length ? (
                <ul className="space-y-0.5">
                  {lc.property.ownerships.map((o) => (
                    <li key={o.id} className="flex items-center justify-between">
                      <span>{o.owner.nome}</span>
                      <Badge variant="outline">{o.percentual}%</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">Nenhum proprietário cadastrado no imóvel.</p>
              )}
            </div>
            <div>
              <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                Locatários ({lc.tenants.length})
              </div>
              {lc.tenants.length ? (
                <ul className="space-y-0.5">
                  {lc.tenants.map((t) => (
                    <li key={t.id} className="flex items-center justify-between">
                      <span>
                        <User className="mr-1 inline h-3.5 w-3.5" />
                        {t.tenant.nome}
                      </span>
                      <Badge variant="outline">{t.tipo}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">Nenhum inquilino vinculado.</p>
              )}
            </div>
            {lc.angariadores.length > 0 && (
              <div>
                <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                  Angariadores ({lc.angariadores.length})
                </div>
                <ul className="space-y-0.5">
                  {lc.angariadores.map((a) => (
                    <li key={a.id}>
                      {a.party.nome} —{" "}
                      {a.formaComissao === "percentual"
                        ? `${a.percentual}%`
                        : fmtBRL(a.valorFixo ?? 0)}{" "}
                      por {a.mesesComissao ?? "todo o contrato"} mes(es)
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Seções operacionais (collapsible via details/summary nativo) */}
      <CollapsibleSection title={`Cobranças (${lc.rentCharges.length})`} defaultOpen={lc.rentCharges.length > 0}>
        <div className="mb-2 flex justify-end">
          <NovaCobrancaExtraDialog leaseContractId={lc.id} />
        </div>
        {lc.rentCharges.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma cobrança ainda. Materializadas mensalmente pelo cron.</p>
        ) : (
          <ul className="divide-y">
            {lc.rentCharges.map((c) => (
              <li key={c.id} className="grid grid-cols-12 items-center gap-3 py-2 text-sm">
                <span className="col-span-2 font-medium">{c.competencia}</span>
                <span className="col-span-3 text-muted-foreground">
                  {c.dueDate.toLocaleDateString("pt-BR")}
                </span>
                <span className="col-span-2">{c.kind}</span>
                <span className="col-span-3 text-right font-medium">
                  {fmtBRL(c.valorBase + c.encargos + c.multa + c.juros)}
                </span>
                <span className="col-span-2 text-right">
                  <Badge variant={c.status === "atrasada" ? "destructive" : "outline"}>{c.status}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>

      <CollapsibleSection title={`Despesas (${lc.expenses.length})`} defaultOpen={lc.expenses.length > 0}>
        {lc.expenses.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem despesas lançadas.</p>
        ) : (
          <ul className="divide-y">
            {lc.expenses.map((e) => (
              <li key={e.id} className="grid grid-cols-12 items-center gap-3 py-2 text-sm">
                <span className="col-span-3">{e.type}</span>
                <span className="col-span-2">{e.parcelaTotal > 1 ? `${e.parcelaN}/${e.parcelaTotal}` : ""}</span>
                <span className="col-span-3 text-muted-foreground">
                  {e.dueDate.toLocaleDateString("pt-BR")} · {e.debitoDe} → {e.creditoPara}
                </span>
                <span className="col-span-2 text-right font-medium">{fmtBRL(e.valor)}</span>
                <span className="col-span-2 text-right">
                  <Badge variant="outline">{e.status}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>

      <CollapsibleSection title={`Checklists (${lc.checklists.length})`}>
        {lc.checklists.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum checklist criado.</p>
        ) : (
          <ul className="divide-y">
            {lc.checklists.map((cl) => (
              <li key={cl.id} className="flex items-center justify-between py-2 text-sm">
                <span>{cl.nome}</span>
                <Badge variant="outline">{cl.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title={`Garantia${lc.guarantee ? ` · ${lc.guarantee.tipo}` : ""}`}
      >
        {!lc.guarantee ? (
          <p className="text-sm text-muted-foreground">Sem garantia formal.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Tipo" value={lc.guarantee.tipo} />
            <Field label="Provider" value={lc.guarantee.provider} />
            <Field label="Status" value={lc.guarantee.status} />
            <Field label="Cobertura" value={lc.guarantee.coberturaMeses ? `${lc.guarantee.coberturaMeses} meses` : "—"} />
            {lc.guarantee.caucaoSubtipo && (
              <Field label="Subtipo caução" value={lc.guarantee.caucaoSubtipo} />
            )}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title={`Apólices de seguro (${lc.insurancePolicies.length})`}>
        {lc.insurancePolicies.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem seguro contratado.</p>
        ) : (
          <ul className="divide-y">
            {lc.insurancePolicies.map((ins) => (
              <li key={ins.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  {ins.seguradora} — {ins.tipo} (resp.{" "}
                  {ins.responsavelPagamento ?? "—"})
                </span>
                <span className="text-xs text-muted-foreground">
                  até {ins.vigenciaFim.toLocaleDateString("pt-BR")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>

      <CollapsibleSection title={`Acordos de dívida (${lc.debtAgreements.length})`}>
        {lc.debtAgreements.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem acordo ativo.</p>
        ) : (
          <ul className="divide-y">
            {lc.debtAgreements.map((da) => (
              <li key={da.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  {fmtBRL(da.valorTotal)} em {da.parcelas}x · 1ª venc.{" "}
                  {da.primeiraDataDue.toLocaleDateString("pt-BR")}
                </span>
                <Badge variant={da.status === "quebrado" ? "destructive" : "outline"}>{da.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>

      <CollapsibleSection title={`Manutenções (${lc.maintenances.length})`}>
        {lc.maintenances.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem manutenção registrada.</p>
        ) : (
          <ul className="divide-y">
            {lc.maintenances.map((m) => (
              <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  {m.tipo}: {m.descricao.slice(0, 90)}
                </span>
                <Badge variant="outline">{m.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>
    </div>
  );
}

function Field({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode | string | null | undefined;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{value || "—"}</div>
    </div>
  );
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="rounded-md border bg-card transition-colors open:bg-card hover:border-foreground/20"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium">
        {title}
        <span className="text-muted-foreground transition-transform">▾</span>
      </summary>
      <div className="border-t px-4 py-3">{children}</div>
    </details>
  );
}
