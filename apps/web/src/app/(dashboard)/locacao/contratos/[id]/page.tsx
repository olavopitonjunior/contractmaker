import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  AlertCircle,
  Building2,
  User,
  Shield,
  FileCheck,
  ClipboardList,
} from "lucide-react";
import { LeaseHeaderActions } from "@/components/locacao/LeaseHeaderActions";
import { NovaCobrancaExtraDialog } from "@/components/locacao/NovaCobrancaExtraDialog";
import { LeaseSection, Field } from "@/components/locacao/lease-detail/LeaseSection";
import { LeaseTabsNav, type LeaseTab } from "@/components/locacao/lease-detail/LeaseTabsNav";
import { SegurosTab } from "@/components/locacao/lease-detail/SegurosTab";
import { GarantiasTab } from "@/components/locacao/lease-detail/GarantiasTab";
import { AIInsightsCard } from "@/components/ai-assist/InsightsCard";
import { ClausulasAdicionaisEditor } from "@/components/locacao/ClausulasAdicionaisEditor";
import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { FEATURE } from "@/lib/modules/catalog";

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

const INSPECTION_STATUS_LABEL: Record<string, string> = {
  rascunho: "Rascunho",
  em_campo: "Em campo",
  laudo_gerado: "Laudo gerado",
  assinatura: "Em assinatura",
  concluida: "Concluída",
};

interface Params {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

const VALID_TABS: LeaseTab[] = ["geral", "seguros", "garantias", "vistoria"];

export default async function LeaseContractDetailPage({ params, searchParams }: Params) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");
  const { id } = await params;
  const sp = await searchParams;

  const modules = await getOrgModules(org.id);
  const segurosOn = isFeatureEnabled(modules, FEATURE.LOCACAO_SEGUROS);
  const vistoriasOn = isFeatureEnabled(modules, FEATURE.LOCACAO_VISTORIAS);

  const tab: LeaseTab = VALID_TABS.includes(sp.tab as LeaseTab)
    ? (sp.tab as LeaseTab)
    : "geral";

  const lc = await prisma.leaseContract.findFirst({
    where: { id, orgId: org.id },
    include: {
      property: {
        include: { ownerships: { include: { owner: { select: { nome: true } } } } },
      },
      tenants: { include: { tenant: { select: { id: true, nome: true, cpfCnpj: true } } } },
      angariadores: { include: { party: { select: { nome: true } } } },
      // Dados das seções da aba Geral. Garantia/apólices migraram pras abas próprias.
      ...(tab === "geral"
        ? {
            rentCharges: { orderBy: { dueDate: "desc" as const }, take: 12 },
            expenses: { orderBy: { dueDate: "desc" as const }, take: 12 },
            checklists: true,
            debtAgreements: true,
            maintenances: { orderBy: { abertaEm: "desc" as const }, take: 10 },
          }
        : {}),
    },
  });
  if (!lc) notFound();

  const templates = await prisma.checklistTemplate.findMany({
    where: { orgId: org.id, ativo: true },
    select: { id: true, nome: true },
    orderBy: { nome: "asc" },
  });

  // Dados por aba (fora da aba Geral, evita over-fetch).
  const [policies, guarantee, inspections] = await Promise.all([
    tab === "seguros"
      ? prisma.insurancePolicy.findMany({
          where: { leaseContractId: id, orgId: org.id },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve(null),
    tab === "garantias"
      ? prisma.guarantee.findUnique({ where: { leaseContractId: id } })
      : Promise.resolve(null),
    tab === "vistoria"
      ? prisma.inspection.findMany({
          where: { leaseContractId: id, orgId: org.id },
          orderBy: { createdAt: "desc" },
          take: 50,
        })
      : Promise.resolve(null),
  ]);

  const endereco = lc.property
    ? [
        [lc.property.rua, lc.property.numero].filter(Boolean).join(", "),
        lc.property.bairro,
        [lc.property.cidade, lc.property.uf].filter(Boolean).join("/"),
      ]
        .filter(Boolean)
        .join(" · ")
    : "—";

  const rentCharges = "rentCharges" in lc ? lc.rentCharges : [];
  const expenses = "expenses" in lc ? lc.expenses : [];
  const checklists = "checklists" in lc ? lc.checklists : [];
  const debtAgreements = "debtAgreements" in lc ? lc.debtAgreements : [];
  const maintenances = "maintenances" in lc ? lc.maintenances : [];

  const cobrancasVencidas = rentCharges.filter((c) => c.status === "atrasada").length;
  const repassesPendentes = rentCharges.filter(
    (c) => c.status === "paga" && !c.repasseTransferId
  ).length;
  const checklistsPendentes = checklists.filter((c) => c.status !== "concluido").length;

  const visibleTabs: Array<{ key: LeaseTab; label: string }> = [
    { key: "geral" as const, label: "Geral" },
    ...(segurosOn ? [{ key: "seguros" as const, label: "Seguros" }] : []),
    { key: "garantias" as const, label: "Garantias" },
    ...(vistoriasOn ? [{ key: "vistoria" as const, label: "Vistoria" }] : []),
  ];

  const featureOffCard = (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        Recurso não habilitado para esta organização. Fale com o administrador da
        plataforma para ativar.
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <Link
        href="/locacao/contratos"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar para contratos
      </Link>

      <Card className={lc.status === "rescisao" ? "border-destructive" : ""}>
        <CardContent className="flex flex-wrap items-start justify-between gap-3 py-4">
          <div>
            <h2 className="text-2xl font-semibold">
              Contrato de Locação{" "}
              {lc.finalidade !== "residencial" ? `(${lc.finalidade})` : "Residencial"}
            </h2>
            <p className="text-sm text-muted-foreground">
              De {lc.vigenciaInicio?.toLocaleDateString("pt-BR") ?? "—"} a{" "}
              {lc.vigenciaFim?.toLocaleDateString("pt-BR") ?? "indeterminado"} · vencimento dia{" "}
              {lc.diaVencimento}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {segurosOn && (
                <Button asChild size="sm" variant={tab === "seguros" ? "default" : "outline"}>
                  <Link href={`/locacao/contratos/${lc.id}?tab=seguros`} scroll={false}>
                    <Shield className="mr-1.5 h-3.5 w-3.5" /> Seguros
                  </Link>
                </Button>
              )}
              <Button asChild size="sm" variant={tab === "garantias" ? "default" : "outline"}>
                <Link href={`/locacao/contratos/${lc.id}?tab=garantias`} scroll={false}>
                  <FileCheck className="mr-1.5 h-3.5 w-3.5" /> Garantias
                </Link>
              </Button>
              {vistoriasOn && (
                <Button asChild size="sm" variant={tab === "vistoria" ? "default" : "outline"}>
                  <Link href={`/locacao/contratos/${lc.id}?tab=vistoria`} scroll={false}>
                    <ClipboardList className="mr-1.5 h-3.5 w-3.5" /> Vistoria
                  </Link>
                </Button>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge variant={STATUS_TONE[lc.status] ?? "outline"} className="text-sm">
              {lc.status}
            </Badge>
            <LeaseHeaderActions leaseId={lc.id} templates={templates} />
          </div>
        </CardContent>
      </Card>

      <LeaseTabsNav leaseId={lc.id} active={tab} tabs={visibleTabs} />

      {tab === "seguros" &&
        (segurosOn ? (
          <SegurosTab
            leaseContractId={lc.id}
            valorAluguel={lc.valorAluguel}
            policies={(policies ?? []).map((p) => ({
              id: p.id,
              tipo: p.tipo,
              seguradora: p.seguradora,
              apoliceNumero: p.apoliceNumero,
              vigenciaInicio: p.vigenciaInicio.toISOString(),
              vigenciaFim: p.vigenciaFim.toISOString(),
              premioMensal: p.premioMensal,
              responsavelPagamento: p.responsavelPagamento,
              status: p.status,
              pdfUrl: p.pdfUrl,
              coberturaJson: p.coberturaJson,
            }))}
          />
        ) : (
          featureOffCard
        ))}

      {tab === "garantias" && (
        <GarantiasTab
          leaseContractId={lc.id}
          valorAluguel={lc.valorAluguel}
          guarantee={
            guarantee
              ? {
                  id: guarantee.id,
                  tipo: guarantee.tipo,
                  caucaoSubtipo: guarantee.caucaoSubtipo,
                  provider: guarantee.provider,
                  status: guarantee.status,
                  coberturaMeses: guarantee.coberturaMeses,
                  custoJson: guarantee.custoJson,
                  dadosJson: guarantee.dadosJson,
                  fiadorPartyJson: guarantee.fiadorPartyJson,
                  externalRef: guarantee.externalRef,
                  documentoPdfUrl: guarantee.documentoPdfUrl,
                  historicoJson: guarantee.historicoJson,
                  updatedAt: guarantee.updatedAt.toISOString(),
                }
              : null
          }
        />
      )}

      {tab === "vistoria" &&
        (vistoriasOn ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-base font-semibold">
                <ClipboardList className="h-4 w-4" /> Vistorias do contrato
              </h3>
              <Button asChild size="sm" variant="outline">
                <Link href="/locacao/vistorias">Gerenciar vistorias</Link>
              </Button>
            </div>
            {(inspections ?? []).length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  Nenhuma vistoria deste contrato. Crie pela central de vistorias.
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-2">
                  <ul className="divide-y text-sm">
                    {(inspections ?? []).map((i) => (
                      <li key={i.id} className="flex items-center justify-between py-2">
                        <span className="capitalize">
                          {i.tipo} · {i.createdAt.toLocaleDateString("pt-BR")}
                        </span>
                        <Badge variant="outline">
                          {INSPECTION_STATUS_LABEL[i.status] ?? i.status}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          featureOffCard
        ))}

      {tab === "geral" && (
        <>
          <AIInsightsCard context="contract" contextId={lc.id} />

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
                  <AlertCircle className="h-3 w-3" /> {checklistsPendentes} checklist(s)
                  pendente(s)
                </Badge>
              )}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardContent className="space-y-3 py-4">
                <h3 className="text-base font-semibold">Contrato</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Field
                    label="Imóvel"
                    value={
                      lc.property ? (
                        <Link
                          href={`/locacao/imoveis/${lc.propertyId}`}
                          className="text-primary hover:underline"
                        >
                          <Building2 className="mr-1 inline h-3.5 w-3.5" />
                          {endereco}
                        </Link>
                      ) : (
                        "—"
                      )
                    }
                    className="col-span-2"
                  />
                  <Field
                    label="Aluguel"
                    value={`${fmtBRL(lc.valorAluguel)} (${
                      lc.regimeCobranca === "mes_vencido" ? "mês vencido" : "mês a vencer"
                    })`}
                  />
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
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-3 py-4">
                <h3 className="text-base font-semibold">Partes</h3>
                <div className="space-y-3 text-sm">
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
                      <p className="text-xs text-muted-foreground">
                        Nenhum proprietário cadastrado no imóvel.
                      </p>
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
                </div>
              </CardContent>
            </Card>
          </div>

          <LeaseSection
            id="cobrancas"
            title={`Cobranças (${rentCharges.length})`}
            defaultOpen={rentCharges.length > 0}
          >
            <div className="mb-2 flex justify-end">
              <NovaCobrancaExtraDialog leaseContractId={lc.id} />
            </div>
            {rentCharges.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma cobrança ainda. Materializadas mensalmente pelo cron.
              </p>
            ) : (
              <ul className="divide-y">
                {rentCharges.map((c) => (
                  <li
                    key={c.id}
                    className="grid grid-cols-12 items-center gap-3 py-2 text-sm"
                  >
                    <span className="col-span-2 font-medium">{c.competencia}</span>
                    <span className="col-span-3 text-muted-foreground">
                      {c.dueDate.toLocaleDateString("pt-BR")}
                    </span>
                    <span className="col-span-2">{c.kind}</span>
                    <span className="col-span-3 text-right font-medium">
                      {fmtBRL(c.valorBase + c.encargos + c.multa + c.juros)}
                    </span>
                    <span className="col-span-2 text-right">
                      <Badge variant={c.status === "atrasada" ? "destructive" : "outline"}>
                        {c.status}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </LeaseSection>

          <LeaseSection
            id="despesas"
            title={`Despesas (${expenses.length})`}
            defaultOpen={expenses.length > 0}
          >
            {expenses.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem despesas lançadas.</p>
            ) : (
              <ul className="divide-y">
                {expenses.map((e) => (
                  <li
                    key={e.id}
                    className="grid grid-cols-12 items-center gap-3 py-2 text-sm"
                  >
                    <span className="col-span-3">{e.type}</span>
                    <span className="col-span-2">
                      {e.parcelaTotal > 1 ? `${e.parcelaN}/${e.parcelaTotal}` : ""}
                    </span>
                    <span className="col-span-3 text-muted-foreground">
                      {e.dueDate.toLocaleDateString("pt-BR")} · {e.debitoDe} → {e.creditoPara}
                    </span>
                    <span className="col-span-2 text-right font-medium">
                      {fmtBRL(e.valor)}
                    </span>
                    <span className="col-span-2 text-right">
                      <Badge variant="outline">{e.status}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </LeaseSection>

          <LeaseSection id="checklists" title={`Checklists (${checklists.length})`}>
            {checklists.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum checklist criado.</p>
            ) : (
              <ul className="divide-y">
                {checklists.map((cl) => (
                  <li key={cl.id} className="flex items-center justify-between py-2 text-sm">
                    <span>{cl.nome}</span>
                    <Badge variant="outline">{cl.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </LeaseSection>

          <LeaseSection
            id="acordos"
            title={`Acordos de dívida (${debtAgreements.length})`}
          >
            {debtAgreements.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem acordo ativo.</p>
            ) : (
              <ul className="divide-y">
                {debtAgreements.map((da) => (
                  <li key={da.id} className="flex items-center justify-between py-2 text-sm">
                    <span>
                      {fmtBRL(da.valorTotal)} em {da.parcelas}x · 1ª venc.{" "}
                      {da.primeiraDataDue.toLocaleDateString("pt-BR")}
                    </span>
                    <Badge variant={da.status === "quebrado" ? "destructive" : "outline"}>
                      {da.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </LeaseSection>

          <LeaseSection
            id="clausulas-adicionais"
            title={`Cláusulas adicionais (${
              (((lc.dataJson ?? {}) as { clausulasAdicionais?: Array<unknown> }).clausulasAdicionais ?? [])
                .length
            })`}
          >
            <ClausulasAdicionaisEditor
              leaseId={lc.id}
              initialClausulas={
                (
                  ((lc.dataJson ?? {}) as {
                    clausulasAdicionais?: Array<{ id?: string; titulo: string; conteudo: string }>;
                  }).clausulasAdicionais ?? []
                ).map((c) => ({
                  id: c.id,
                  titulo: c.titulo,
                  conteudo: c.conteudo,
                }))
              }
            />
          </LeaseSection>

          <LeaseSection id="reajustes" title="Reajustes">
            <p className="text-sm text-muted-foreground">
              {lc.dataProximoReajuste ? (
                <>
                  Próximo reajuste previsto em{" "}
                  <strong>{lc.dataProximoReajuste.toLocaleDateString("pt-BR")}</strong>. Índice base:{" "}
                  <strong>{lc.indiceReajuste}</strong>.
                </>
              ) : (
                <>Sem data de próximo reajuste cadastrada.</>
              )}
            </p>
            <div className="mt-3">
              <Link
                href={`/locacao/contratos/${lc.id}/reajustes`}
                className="text-sm text-primary hover:underline"
              >
                Ver histórico e aplicar reajuste →
              </Link>
            </div>
          </LeaseSection>

          <LeaseSection id="manutencoes" title={`Manutenções (${maintenances.length})`}>
            {maintenances.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem manutenção registrada.</p>
            ) : (
              <ul className="divide-y">
                {maintenances.map((m) => (
                  <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                    <span>
                      {m.tipo}: {m.descricao.slice(0, 90)}
                    </span>
                    <Badge variant="outline">{m.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </LeaseSection>
        </>
      )}
    </div>
  );
}
