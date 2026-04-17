"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  SkipForward,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

interface EndpointDef {
  id: string;
  label: string;
  costCents: number;
  scope: string;
  uf: string | null;
  category: string;
  description: string | null;
}

interface AdhocJob {
  id: string;
  batchId: string;
  endpoint: string;
  label: string;
  status: string;
  resultCode: number | null;
  resultMessage: string | null;
  resultData: unknown;
  errorMessage: string | null;
  costCents: number | null;
  latencyMs: number | null;
  createdAt: string;
}

interface Props {
  endpoints: EndpointDef[];
}

/**
 * Phase C — UI para disparar certidões ad-hoc (sem Deal).
 *
 * Fluxo:
 *   1. Usuário preenche CPF/CNPJ + UF + opcional (data nascimento, cidade)
 *   2. Seleciona 1+ endpoints do catálogo (filtrados por PF/PJ e escopo)
 *   3. POST /api/certidoes/adhoc → recebe batchId
 *   4. Poll GET a cada 2s até todos os jobs serem terminais
 *   5. Lista resultados com links para site_receipts (PDFs da Infosimples)
 */
export function AdhocCertidoesClient({ endpoints }: Props) {
  const [tipoPessoa, setTipoPessoa] = useState<"fisica" | "juridica">("fisica");
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [dataNascimento, setDataNascimento] = useState("");
  const [uf, setUf] = useState("");
  const [cidade, setCidade] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<AdhocJob[]>([]);

  // Filter endpoints by context: PF vs PJ + UF compatibility.
  const availableEndpoints = useMemo(() => {
    return endpoints.filter((e) => {
      // Estadual: só mostra se UF do alvo bate com UF do endpoint
      if (e.scope === "estadual" && e.uf && uf && e.uf !== uf.toUpperCase()) {
        return false;
      }
      return true;
    });
  }, [endpoints, uf]);

  const grouped = useMemo(() => {
    const byCategory: Record<string, EndpointDef[]> = {};
    for (const e of availableEndpoints) {
      const cat = e.category;
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(e);
    }
    return byCategory;
  }, [availableEndpoints]);

  const toggleEndpoint = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const estimatedCost = useMemo(() => {
    let cents = 0;
    for (const id of selected) {
      const e = endpoints.find((x) => x.id === id);
      if (e) cents += e.costCents;
    }
    return cents;
  }, [selected, endpoints]);

  const canSubmit =
    nome.trim().length > 0 &&
    ((tipoPessoa === "fisica" && cpf.trim().length > 0) ||
      (tipoPessoa === "juridica" && cnpj.trim().length > 0)) &&
    selected.size > 0 &&
    !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const newBatchId = crypto.randomUUID();
      const res = await fetch("/api/certidoes/adhoc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: newBatchId,
          target: {
            tipoPessoa,
            nome,
            cpf: tipoPessoa === "fisica" ? cpf : null,
            cnpj: tipoPessoa === "juridica" ? cnpj : null,
            dataNascimento: dataNascimento || null,
            uf: uf ? uf.toUpperCase() : null,
            cidade: cidade || null,
          },
          endpointIds: Array.from(selected),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Falha ao disparar consulta");
        return;
      }
      setBatchId(newBatchId);
      toast.success(`Consulta iniciada (${data.jobCount} job(s))`);
    } finally {
      setSubmitting(false);
    }
  };

  // Poll for batch status while there are non-terminal jobs
  useEffect(() => {
    if (!batchId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/certidoes/adhoc?batchId=${batchId}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setJobs(data.jobs ?? []);
      } catch {
        /* ignore transient */
      }
    };
    poll();
    const interval = setInterval(() => {
      const anyPending = jobs.some(
        (j) =>
          j.status === "pending" ||
          j.status === "fetching" ||
          j.status === "awaiting_portal"
      );
      if (!anyPending && jobs.length > 0) {
        clearInterval(interval);
        return;
      }
      poll();
    }, 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [batchId, jobs]);

  const reset = () => {
    setBatchId(null);
    setJobs([]);
    setSelected(new Set());
  };

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold">Diligência avulsa</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Consulte certidões para um CPF ou CNPJ sem precisar criar um
          negócio. Útil para diligenciar sócios, fiadores, testemunhas ou
          validar prospects.
        </p>
      </div>

      {batchId ? (
        <BatchResults jobs={jobs} onReset={reset} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dados do alvo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Button
                  variant={tipoPessoa === "fisica" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTipoPessoa("fisica")}
                >
                  Pessoa física
                </Button>
                <Button
                  variant={tipoPessoa === "juridica" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTipoPessoa("juridica")}
                >
                  Pessoa jurídica
                </Button>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">
                  {tipoPessoa === "juridica" ? "Razão social" : "Nome completo"}
                </Label>
                <Input
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder={
                    tipoPessoa === "juridica"
                      ? "Empresa X LTDA"
                      : "Maria Souza"
                  }
                />
              </div>
              {tipoPessoa === "fisica" ? (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">CPF</Label>
                    <Input
                      value={cpf}
                      onChange={(e) => setCpf(e.target.value)}
                      placeholder="000.000.000-00"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Data de nascimento (opcional)</Label>
                    <Input
                      type="date"
                      value={dataNascimento}
                      onChange={(e) => setDataNascimento(e.target.value)}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Obrigatória para PGFN (CND Federal).
                    </p>
                  </div>
                </>
              ) : (
                <div className="space-y-1">
                  <Label className="text-xs">CNPJ</Label>
                  <Input
                    value={cnpj}
                    onChange={(e) => setCnpj(e.target.value)}
                    placeholder="00.000.000/0000-00"
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">UF</Label>
                  <Input
                    maxLength={2}
                    value={uf}
                    onChange={(e) => setUf(e.target.value.toUpperCase())}
                    placeholder="SP"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Cidade</Label>
                  <Input
                    value={cidade}
                    onChange={(e) => setCidade(e.target.value)}
                    placeholder="São Paulo"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>Certidões a consultar</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {selected.size} selec. · R${" "}
                  {(estimatedCost / 100).toFixed(2).replace(".", ",")}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 max-h-[460px] overflow-auto">
              {Object.keys(grouped).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Preencha UF para ver endpoints estaduais compatíveis.
                </p>
              ) : (
                Object.entries(grouped).map(([cat, eps]) => (
                  <div key={cat} className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                      {cat}
                    </p>
                    {eps.map((e) => (
                      <label
                        key={e.id}
                        className="flex items-start gap-2 rounded border border-transparent hover:bg-muted/50 px-2 py-1.5 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(e.id)}
                          onChange={() => toggleEndpoint(e.id)}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">{e.label}</div>
                          {e.description && (
                            <div className="text-[11px] text-muted-foreground">
                              {e.description}
                            </div>
                          )}
                        </div>
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                          R$ {(e.costCents / 100).toFixed(2).replace(".", ",")}
                        </span>
                      </label>
                    ))}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <div className="lg:col-span-2 flex justify-end">
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit}
              size="lg"
              className="min-w-[200px]"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Disparando…
                </>
              ) : (
                <>
                  <Search className="h-4 w-4 mr-2" />
                  Consultar certidões
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function BatchResults({
  jobs,
  onReset,
}: {
  jobs: AdhocJob[];
  onReset: () => void;
}) {
  const pending = jobs.filter(
    (j) =>
      j.status === "pending" ||
      j.status === "fetching" ||
      j.status === "awaiting_portal"
  ).length;
  const success = jobs.filter((j) => j.status === "success").length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const skipped = jobs.filter((j) => j.status === "skipped").length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Resultados do batch</CardTitle>
          <Button variant="ghost" size="sm" onClick={onReset}>
            Nova consulta
          </Button>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3 text-sm">
          <Badge variant="outline" className="gap-1">
            <CheckCircle2 className="h-3 w-3 text-green-600" /> {success} prontas
          </Badge>
          {pending > 0 && (
            <Badge variant="outline" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin text-blue-600" />{" "}
              {pending} em andamento
            </Badge>
          )}
          {failed > 0 && (
            <Badge variant="outline" className="gap-1">
              <XCircle className="h-3 w-3 text-red-600" /> {failed} falhas
            </Badge>
          )}
          {skipped > 0 && (
            <Badge variant="outline" className="gap-1">
              <SkipForward className="h-3 w-3" /> {skipped} puladas
            </Badge>
          )}
        </CardContent>
      </Card>

      <div className="space-y-2">
        {jobs.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Aguardando primeiros resultados…</p>
            </CardContent>
          </Card>
        ) : (
          jobs.map((job) => <AdhocJobRow key={job.id} job={job} />)
        )}
      </div>
    </div>
  );
}

function AdhocJobRow({ job }: { job: AdhocJob }) {
  const resultData = job.resultData as
    | { situacao?: string; detalhes?: string; _rawReceipt?: string }
    | null;
  const situacao = resultData?.situacao;
  const receipt = resultData?._rawReceipt;

  let icon = <Loader2 className="h-4 w-4 animate-spin text-blue-600" />;
  let bg = "bg-blue-50/30 border-blue-200";
  let label = "Consultando…";
  if (job.status === "success") {
    if (situacao === "negativa" || situacao === "aguardando_pdf") {
      icon = <CheckCircle2 className="h-4 w-4 text-green-600" />;
      bg = "bg-green-50/30 border-green-200";
      label = situacao === "aguardando_pdf" ? "Negativa · aguardando PDF" : "Nada consta";
    } else if (situacao === "positiva" || situacao === "positiva_com_efeitos") {
      icon = <CheckCircle2 className="h-4 w-4 text-amber-600" />;
      bg = "bg-amber-50 border-amber-200";
      label = "Consta débito";
    } else if (situacao === "informativa") {
      icon = <CheckCircle2 className="h-4 w-4 text-blue-600" />;
      bg = "bg-blue-50/30 border-blue-200";
      label = "Consulta informativa";
    } else {
      icon = <XCircle className="h-4 w-4 text-muted-foreground" />;
      bg = "bg-muted/20 border-muted";
      label = resultData?.detalhes || "Não emitida";
    }
  } else if (job.status === "failed") {
    icon = <XCircle className="h-4 w-4 text-red-600" />;
    bg = "bg-red-50 border-red-200";
    label = job.errorMessage || "Erro";
  } else if (job.status === "awaiting_portal") {
    icon = <Clock className="h-4 w-4 text-amber-600" />;
    bg = "bg-amber-50 border-amber-200";
    label = "Aguardando portal";
  } else if (job.status === "skipped") {
    icon = <SkipForward className="h-4 w-4 text-muted-foreground" />;
    bg = "bg-muted/20 border-muted";
    label = job.errorMessage || "Pulado";
  }

  return (
    <div className={`rounded border p-3 flex items-start gap-2.5 ${bg}`}>
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">{job.label}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
        {(job.costCents != null || job.latencyMs != null) && (
          <div className="text-[10px] text-muted-foreground mt-0.5 flex gap-2">
            {job.costCents != null && job.costCents > 0 && (
              <span>R$ {(job.costCents / 100).toFixed(2).replace(".", ",")}</span>
            )}
            {job.latencyMs != null && job.latencyMs > 0 && (
              <span>{Math.round(job.latencyMs / 1000)}s</span>
            )}
          </div>
        )}
      </div>
      {receipt && (
        <Button variant="ghost" size="sm" asChild className="h-7 px-2">
          <a href={receipt} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3 w-3" />
          </a>
        </Button>
      )}
    </div>
  );
}
