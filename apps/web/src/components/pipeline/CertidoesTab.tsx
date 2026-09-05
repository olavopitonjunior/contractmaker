"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  SkipForward,
  RefreshCw,
  FileText,
  Wallet,
  ExternalLink,
  AlertTriangle,
  Sparkles,
  Download,
  Share2,
  Trash2,
  CalendarClock,
  Archive,
  Eye,
  LifeBuoy,
  Info,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useCertidoesBatch, type CertidaoJobRow } from "@/hooks/useCertidoesBatch";
import { ExtractCertidoesDialog, type JobSelection } from "./ExtractCertidoesDialog";
import { isInProgressBlocking, isRetryableError } from "@/lib/certidoes/lifecycle";
import { CertidaoDetailDialog } from "./CertidaoDetailDialog";
import { SerasaConsentDialog } from "./SerasaConsentDialog";
import { ComplementDadosForm } from "./ComplementDadosForm";
import { ShareCertidoesDialog } from "./ShareCertidoesDialog";
import { DiligentedPersonsSection } from "./DiligentedPersonsSection";
import { DiligentedPersonDialog } from "./DiligentedPersonDialog";
import { CertidoesAnalysisPanel } from "./CertidoesAnalysisPanel";
import { EditPartyDialog } from "./EditPartyDialog";
import { KIND_LABEL } from "./certidoes-groups";
import type { CertidoesEsteira } from "@/lib/certidoes/target-paths";
import {
  CATEGORY_LABEL,
  isUserFixable,
  type FailureCategory,
} from "@/lib/certidoes/error-codes";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Dependente {
  nome?: string;
  cpf?: string;
}

interface CertidoesTabProps {
  dealId: string;
  vendedores: Array<{
    nome?: string;
    razao_social?: string;
    tipo_pessoa?: string;
    // Dependentes do vendedor — diligenciados junto (cônjuge/procurador/
    // representante). Usados para rotular os grupos de certidões.
    conjuge?: Dependente;
    procurador?: Dependente;
    representante?: Dependente;
  }>;
  compradores: Array<{ nome?: string; razao_social?: string }>;
  imoveis: Array<{
    rua?: string;
    numero?: string;
    cidade?: string;
  }>;
  /**
   * Locação (2026-09-03): a aba é a mesma; muda o shape das partes. O imóvel
   * singular do form entra como `imoveis[0]` (chave de grupo `imovel-0`).
   */
  esteira?: CertidoesEsteira;
  locadores?: Array<{ nome?: string; razao_social?: string }>;
  locatarios?: Array<{ nome?: string; razao_social?: string }>;
  /** Fiador só quando a garantia É fiança (mesma regra do planner). */
  fiador?: { nome?: string; razao_social?: string; tipo_pessoa?: string; conjuge?: Dependente } | null;
  /**
   * PROPOSTA (2026-09): a mesma aba sobre `/api/proposals/:id/certidoes`.
   * `dealId` passa a ser só a chave de identidade do sujeito; as URLs vêm das
   * bases. Na proposta não existem diligenciados, análise IA, ZIP,
   * compartilhamento nem retentar em massa (superfícies do negócio).
   */
  subject?: "deal" | "proposal";
  apiBase?: string;
  attachmentsBase?: string;
  /** Onde ler o dataJson para o "Corrigir dados" (default `/api/deals/:id`). */
  dataUrl?: string;
}

/** Identidade útil de dependente: tem CPF ou ao menos nome. */
function hasDependente(d: Dependente | undefined): d is Dependente {
  return !!d && !!((d.cpf && d.cpf.trim()) || (d.nome && d.nome.trim()));
}

function imovelLabel(im: {
  rua?: string;
  numero?: string;
  cidade?: string;
}, index: number): string {
  const parts: string[] = [];
  if (im.rua) parts.push(im.rua);
  if (im.numero && im.numero.trim() !== "" && im.numero.trim() !== "nº") {
    parts.push(`nº ${im.numero}`);
  }
  if (im.cidade) parts.push(im.cidade);
  const label = parts.join(", ");
  return label || `Imóvel #${index + 1}`;
}

const STALE_AFTER_MS = 5 * 60_000;

function statusIcon(row: CertidaoJobRow) {
  const status = effectiveStatus(row);
  switch (status) {
    case "success": {
      const r = row.resultData as { situacao?: string } | null;
      if (r?.situacao === "aguardando_pdf") {
        return <Clock className="h-4 w-4 text-blue-600" />;
      }
      if (r?.situacao === "nao_emitida") {
        return <XCircle className="h-4 w-4 text-red-600" />;
      }
      return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    }
    // J.6 (Phase J, 2026-04-18) — estados ricos. Informativo = info azul
    // (Receita CNPJ, CRF FGTS), não "certidão". Falha permanente = vermelho
    // com CTA portal. Retry pendente = relógio azul com countdown.
    case "informativo":
      return <Info className="h-4 w-4 text-sky-600" />;
    case "failed_permanent":
      return <AlertTriangle className="h-4 w-4 text-red-600" />;
    case "data_missing":
    case "data_invalid":
      return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    case "api_error":
    case "portal_unavailable":
    case "rate_limited":
      return <RefreshCw className="h-4 w-4 text-blue-500 animate-spin [animation-duration:2s]" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-red-600" />;
    case "fetching":
    case "pending":
      return <Loader2 className="h-4 w-4 animate-spin text-blue-600" />;
    case "awaiting_portal":
      return <Clock className="h-4 w-4 text-amber-600" />;
    case "duplicate_pending":
      return <CalendarClock className="h-4 w-4 text-amber-600" />;
    case "skipped":
      return <SkipForward className="h-4 w-4 text-muted-foreground" />;
    case "replaced":
      return <Archive className="h-4 w-4 text-muted-foreground" />;
  }
}

/**
 * J.6 — formata "em ~X min" / "em ~N dias" baseado em nextRetryAt.
 */
function formatRelativeTo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  const now = Date.now();
  const diffMin = Math.round((target - now) / 60_000);
  if (diffMin <= 0) return "agora";
  if (diffMin < 60) return `em ~${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `em ~${diffH}h`;
  const diffD = Math.round(diffH / 24);
  return `em ~${diffD}d`;
}

function formatDateBR(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("pt-BR");
  } catch {
    return null;
  }
}

// A row has "valid data" when the backend has persisted a recognized
// `situacao` — even if the job's status field still says "fetching" (race
// with the container dying right after the Prisma update). The UI trusts
// resultData over status whenever both exist.
function hasValidResult(row: CertidaoJobRow): boolean {
  const r = row.resultData as { situacao?: string } | null;
  if (!r || typeof r.situacao !== "string") return false;
  return (
    row.resultCode === 200 &&
    ["negativa", "positiva", "positiva_com_efeitos", "nao_emitida", "aguardando_pdf"].includes(
      r.situacao
    )
  );
}

function effectiveStatus(row: CertidaoJobRow): CertidaoJobRow["status"] {
  // Protect against "ghost fetching": when the backend has valid data but the
  // job row's status is still non-terminal (container died before finishing
  // the update, or polling caught a stale row), trust the data.
  if (
    (row.status === "fetching" || row.status === "pending") &&
    hasValidResult(row)
  ) {
    return "success";
  }
  return row.status;
}

/**
 * Phase F.II-α — estado "Pendente" unificado: pending, fetching e
 * awaiting_portal todos viram "Pendente" na UI, com subtítulo específico.
 * Evita que o usuário interprete "aguardando_portal" como erro.
 */
function statusLabel(row: CertidaoJobRow): string {
  const r = row.resultData as { situacao?: string; detalhes?: string } | null;
  const status = effectiveStatus(row);
  // "Sem saldo" (account_issue / 603) tem precedência: antes caía em
  // failed_permanent → "use o portal oficial", enganoso. É só recarregar e
  // retentar. (2026-06-05)
  if (getFailureCategory(row) === "account_issue") {
    // Não vaza detalhe de plataforma (conta/saldo do provedor) pro tenant, que
    // não acessa isso — é o suporte que resolve. Mensagem acionável só no que
    // depende do usuário: aguardar/retentar.
    return "Emissão temporariamente indisponível — nova tentativa em breve";
  }
  if (status === "failed") return row.errorMessage || "Erro";
  if (status === "pending") return "Pendente · na fila";
  if (status === "fetching") return "Pendente · consultando";
  if (status === "awaiting_portal") {
    // Previsão real por portal (prazo de emissão do órgão, não do nosso poll).
    const ep = row.endpoint.toLowerCase();
    if (ep.includes("tjrj")) return "Pendente · aguardando portal (até 8 dias úteis)";
    if (ep.includes("tjms")) return "Pendente · aguardando portal (até 48h)";
    if (ep.includes("tjsp")) return "Pendente · aguardando portal (até 5 dias úteis)";
    if (ep.includes("registradores")) return "Pendente · aguardando portal (até 5 dias úteis)";
    return "Pendente · aguardando portal";
  }
  // J.6 (Phase J, 2026-04-18) — estados ricos
  if (status === "api_error") {
    const retry = formatRelativeTo(row.nextRetryAt);
    return retry
      ? `Instabilidade — tentando novamente ${retry}`
      : "Instabilidade na API — tentando novamente";
  }
  if (status === "portal_unavailable") {
    const retry = formatRelativeTo(row.nextRetryAt);
    return retry
      ? `Portal fora do ar — nova tentativa ${retry}`
      : "Portal fora do ar — nova tentativa agendada";
  }
  if (status === "rate_limited") {
    const retry = formatRelativeTo(row.nextRetryAt);
    return retry
      ? `Limite do portal atingido — nova tentativa ${retry}`
      : "Limite do portal atingido — nova tentativa agendada";
  }
  if (status === "data_missing") {
    return row.errorMessage
      ? `Faltam dados · ${row.errorMessage}`
      : "Faltam dados da parte — complete para emitir";
  }
  if (status === "data_invalid") {
    const msg = row.errorMessage ?? "";
    // Divergência ESPECÍFICA de data de nascimento (Receita/PGFN 608 "Data de
    // nascimento ... diferente da cadastrada"): mensagem orientada à ação com o
    // valor em destaque. O gate exclui mensagens que citam OUTROS campos
    // possíveis ("nome, nome da mãe ou data de nascimento" do Antecedentes PF)
    // — afirmar "é a data" quando pode ser o nome manda corrigir o campo errado.
    if (
      /nascimento|birthdate/i.test(msg) &&
      /diverg|diferente|n[ãa]o\s+confere/i.test(msg) &&
      !/nome/i.test(msg)
    ) {
      const data = msg.match(/\b\d{2}\/\d{2}\/\d{4}\b/)?.[0];
      return data
        ? `A data de nascimento ${data} não confere com a base oficial — confira o cadastro da parte`
        : "A data de nascimento não confere com a base oficial — confira o cadastro da parte";
    }
    return msg
      ? `Dados divergentes · ${msg}`
      : "Dados divergentes — portal não reconheceu";
  }
  if (status === "informativo") {
    return "Consulta informativa (não é certidão)";
  }
  if (status === "duplicate_pending") {
    const ep = row.endpoint.toLowerCase();
    const eta = ep.includes("tjrj")
      ? "previsão até 8 dias úteis"
      : ep.includes("tjms")
      ? "previsão até 48h"
      : ep.includes("tjsp")
      ? "previsão até 5 dias úteis"
      : "aguarde o portal";
    return `Pedido já em andamento no portal · ${eta}`;
  }
  if (status === "failed_permanent") {
    // Mostra a RAZÃO real quando existe (timeout interno ≠ fonte fora do ar ≠
    // recusa do órgão) — o rótulo genérico escondia o motivo e sugeria
    // indisponibilidade do portal até pra falha nossa. O CTA "portal oficial"
    // continua vindo do botão de portalUrl.
    if (row.errorMessage) return row.errorMessage;
    return row.portalUrl
      ? "Indisponível automaticamente — use o portal oficial"
      : "Falha permanente";
  }
  if (status === "skipped") return row.errorMessage || "Pulado — dados faltantes";
  if (status === "replaced") return "Substituído";
  if (status === "success") {
    switch (r?.situacao) {
      case "negativa":
        return "Negativa · nada consta";
      case "positiva":
        return "Positiva · consta débito";
      case "positiva_com_efeitos":
        return "Positiva com efeitos de negativa";
      case "nao_emitida":
        return "Não emitida pelo portal";
      case "aguardando_pdf":
        return "Negativa · aguardando PDF";
      case "informativa":
        return "Consulta informativa";
      default:
        return r?.detalhes || "Concluído";
    }
  }
  return "—";
}

/**
 * Régua de cores (decisão do usuário 2026-05-22): a cor reflete se a API
 * FUNCIONOU, não se virou um PDF de certidão.
 *   🟢 green   = a consulta/API funcionou e retornou (success/informativo —
 *                inclui negativa, positiva e informativa; badge explica).
 *   🟡 yellow  = pendente / vai re-tentar (na fila, consultando, aguardando
 *                portal, duplicado, retry transitório).
 *   🔴 red     = erro e não saiu / precisa ação (failed, falha permanente,
 *                falta dado, dados divergentes).
 *   ⚪ neutral = fora da régua: sem cobertura de API (skipped) / substituído.
 */
export type ColorTier = "green" | "yellow" | "red" | "neutral";

function colorTier(row: CertidaoJobRow): ColorTier {
  switch (effectiveStatus(row)) {
    case "success":
    case "informativo":
      return "green";
    case "pending":
    case "fetching":
    case "awaiting_portal":
    case "duplicate_pending":
    case "api_error":
    case "portal_unavailable":
    case "rate_limited":
      return "yellow";
    case "failed":
    case "failed_permanent":
    case "data_missing":
    case "data_invalid":
      return "red";
    case "skipped":
    case "replaced":
    default:
      return "neutral";
  }
}

function statusVariant(row: CertidaoJobRow): string {
  if (effectiveStatus(row) === "replaced")
    return "border-muted bg-muted/10 opacity-60";
  switch (colorTier(row)) {
    case "green":
      return "border-success/30 bg-success/5";
    case "yellow":
      return "border-warning/30 bg-warning/5";
    case "red":
      return "border-destructive/30 bg-destructive/5";
    case "neutral":
    default:
      return "border-muted bg-muted/20";
  }
}

/**
 * Returns the failureCategory when a job needs category-specific UX. Only set
 * on success responses where the situacao is a failure-like state — for
 * status === "failed" (transport error) the category is left undefined.
 */
function getFailureCategory(row: CertidaoJobRow): FailureCategory | undefined {
  const r = row.resultData as { failureCategory?: FailureCategory } | null;
  return r?.failureCategory;
}

function groupKey(row: CertidaoJobRow): string {
  return `${row.targetKind}-${row.targetIndex}`;
}

function isStuck(row: CertidaoJobRow): boolean {
  const status = effectiveStatus(row);
  if (status !== "fetching" && status !== "pending") return false;
  const started = new Date(row.createdAt).getTime();
  return Date.now() - started > STALE_AFTER_MS;
}

// Median + outlier filter for latency display. Filters out nulls and values
// that are >3x the median (e.g. CENPROT SP 1071s when most are ~20s).
function medianLatency(jobs: CertidaoJobRow[]): number {
  const values = jobs
    .map((j) => j.latencyMs)
    .filter((n): n is number => typeof n === "number" && n > 0)
    .sort((a, b) => a - b);
  if (values.length === 0) return 0;
  const mid = Math.floor(values.length / 2);
  const median =
    values.length % 2 === 0
      ? (values[mid - 1] + values[mid]) / 2
      : values[mid];
  // Filter out outliers (>3x median) and recompute
  const filtered = values.filter((v) => v <= median * 3);
  if (filtered.length === 0) return Math.round(median / 1000);
  const avg = filtered.reduce((a, b) => a + b, 0) / filtered.length;
  return Math.round(avg / 1000);
}

export function CertidoesTab({
  dealId,
  vendedores,
  compradores,
  imoveis,
  esteira = "venda",
  locadores = [],
  locatarios = [],
  fiador = null,
  subject = "deal",
  apiBase: apiBaseProp,
  attachmentsBase: attachmentsBaseProp,
  dataUrl,
}: CertidoesTabProps) {
  const isProposal = subject === "proposal";
  const apiBase = apiBaseProp ?? `/api/deals/${dealId}/certidoes`;
  const attachmentsBase = attachmentsBaseProp ?? `/api/deals/${dealId}/attachments`;
  const {
    jobs,
    loading,
    error,
    extract,
    retry,
    deleteJob,
    bulkDelete,
    sweepStale,
    completeSkipped,
    refresh,
  } = useCertidoesBatch({ apiBase });
  const [dialogOpen, setDialogOpen] = useState(false);
  // "+ Adicionar outras pessoas" dentro da popup de certidões. Ao criar, remonta
  // a popup (certKey) pra o plano recarregar com a nova pessoa.
  const [addPersonOpen, setAddPersonOpen] = useState(false);
  const [certKey, setCertKey] = useState(0);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // Serasa LGPD: quando POST /certidoes retorna 412 requiresConsent, abrimos
  // o ConsentDialog e re-tentamos automaticamente com os mesmos jobs.
  const [pendingConsentJobs, setPendingConsentJobs] = useState<JobSelection[] | null>(null);
  const [detailJob, setDetailJob] = useState<CertidaoJobRow | null>(null);
  const [complementJobId, setComplementJobId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Phase A: editing party inline from the certidão card when the portal
  // returned "inconsistent_input" (nome/data nascimento divergente). Opens
  // EditPartyDialog pre-filled with the current party snapshot; on save,
  // PATCHes the deal and retries the job.
  const [editingPartyJob, setEditingPartyJob] = useState<CertidaoJobRow | null>(null);
  // Toggle "ver histórico": inclui as tentativas substituídas (replaced),
  // ocultas por padrão. O backend já marca a tentativa antiga de cada alvo
  // como replaced quando um novo lote roda — aqui só decidimos exibir ou não.
  const [showHistory, setShowHistory] = useState(false);
  // Filtro por status (chips): all | success | awaiting | action | failed.
  const [statusFilter, setStatusFilter] = useState<
    "all" | "success" | "awaiting" | "action" | "failed"
  >("all");
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // D — Análise IA é on-demand: só monta/roda o painel ao clicar (toggle).
  const [showAnalysis, setShowAnalysis] = useState(false);
  // B3 — grupos por parte recolhíveis/expansíveis (key colapsada = recolhida).
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Base para stats: sempre exclui replaced (comportamento original).
  const visibleJobs = useMemo(
    () => jobs.filter((j) => j.status !== "replaced"),
    [jobs]
  );
  const replacedCount = useMemo(
    () => jobs.filter((j) => j.status === "replaced").length,
    [jobs]
  );

  // E2 — mapa (endpoint|kind|index) → cor da régua do job vivo, pra o dialog de
  // extração marcar o que já foi puxado e oferecer "selecionar só faltantes".
  // Agrega pelo ATENDIMENTO MAIS RECENTE por alvo (max createdAt): antes era
  // last-write-wins na ordem da lista, então um zumbi `awaiting_portal` (amarelo)
  // escondia um erro mais novo (vermelho) e o "Só as que faltaram" pulava o alvo
  // (bug do TJSP, 2026-06-05).
  const extractedStatus = useMemo(() => {
    const latest: Record<string, CertidaoJobRow> = {};
    for (const j of visibleJobs) {
      const k = `${j.endpoint}|${j.targetKind}|${j.targetIndex}`;
      const cur = latest[k];
      if (
        !cur ||
        new Date(j.createdAt).getTime() > new Date(cur.createdAt).getTime()
      ) {
        latest[k] = j;
      }
    }
    const m: Record<string, ColorTier> = {};
    for (const k of Object.keys(latest)) m[k] = colorTier(latest[k]);
    return m;
  }, [visibleJobs]);

  // Alvos GENUINAMENTE em andamento (qualquer tentativa bloqueante: pending/
  // fetching recente ou awaiting_portal com protocolo). O dialog usa isto pra
  // travar o checkbox e o "Só as que faltaram" pra não re-pedir o que aguarda o
  // tribunal. Espelha a trava por alvo do backend.
  const inProgressKeys = useMemo(() => {
    const s = new Set<string>();
    for (const j of visibleJobs) {
      if (isInProgressBlocking(j)) {
        s.add(`${j.endpoint}|${j.targetKind}|${j.targetIndex}`);
      }
    }
    return s;
  }, [visibleJobs]);

  // Há algum alvo com erro de SALDO (account_issue)? Banner org-wide no topo.
  const hasAccountIssue = useMemo(
    () => visibleJobs.some((j) => getFailureCategory(j) === "account_issue"),
    [visibleJobs]
  );

  // Alvos com erro retentável (pra o botão "Retentar erros" de 1 clique).
  const retryableErrorJobs = useMemo(
    () => visibleJobs.filter((j) => isRetryableError(j)),
    [visibleJobs]
  );

  // Categoriza um job para o filtro por status.
  const filterBucket = (
    row: CertidaoJobRow
  ): "success" | "awaiting" | "action" | "failed" | "other" => {
    const s = effectiveStatus(row);
    if (s === "success" || s === "informativo") return "success";
    if (
      s === "awaiting_portal" ||
      s === "duplicate_pending" ||
      s === "fetching" ||
      s === "pending"
    )
      return "awaiting";
    if (s === "data_missing" || s === "data_invalid" || s === "failed_permanent" || s === "skipped")
      return "action";
    if (s === "failed" || s === "api_error" || s === "portal_unavailable" || s === "rate_limited")
      return "failed";
    return "other";
  };

  // Conjunto exibido nos grupos: respeita histórico + filtro por status.
  const displayJobs = useMemo(() => {
    const base = showHistory ? jobs : visibleJobs;
    if (statusFilter === "all") return base;
    return base.filter((j) => filterBucket(j) === statusFilter);
  }, [jobs, visibleJobs, showHistory, statusFilter]);

  const groups = useMemo(() => {
    // Grupos por alvo: Vendedor, Comprador, Imóvel e Diligência avulsa
    // (fallback). A trilha de imóvel (matrícula/IPTU/CCIR) foi reativada no
    // Phase L (2026-05-22) — os jobs com targetKind="imovel" voltam a renderizar
    // num grupo "Imóvel:" próprio (antes eram dropados, resquício do Phase F.II-α).
    const map = new Map<string, { label: string; rows: CertidaoJobRow[] }>();
    vendedores.forEach((v, i) => {
      const vLabel = v.nome || v.razao_social || `Parte ${i + 1}`;
      map.set(`vendedor-${i}`, { label: `Vendedor: ${vLabel}`, rows: [] });
      // Dependentes do vendedor (cônjuge/procurador/representante) ganham grupo
      // próprio, rotulado com o titular para contexto. Grupos sem jobs são
      // filtrados no final.
      if (hasDependente(v.conjuge)) {
        map.set(`conjuge_vendedor-${i}`, {
          label: `Cônjuge de ${vLabel}: ${v.conjuge.nome || "—"}`,
          rows: [],
        });
      }
      if (hasDependente(v.procurador)) {
        map.set(`procurador_vendedor-${i}`, {
          label: `Procurador de ${vLabel}: ${v.procurador.nome || "—"}`,
          rows: [],
        });
      }
      if (hasDependente(v.representante)) {
        map.set(`representante_vendedor-${i}`, {
          label: `Representante de ${vLabel}: ${v.representante.nome || "—"}`,
          rows: [],
        });
      }
    });
    compradores.forEach((c, i) =>
      map.set(`comprador-${i}`, {
        label: `Comprador: ${c.nome || c.razao_social || `Parte ${i + 1}`}`,
        rows: [],
      })
    );
    imoveis.forEach((im, i) =>
      map.set(`imovel-${i}`, {
        label: `Imóvel: ${imovelLabel(im, i)}`,
        rows: [],
      })
    );
    // Locação: locatário, fiador (+ cônjuge, índice 0 — objeto) e locador.
    locatarios.forEach((p, i) =>
      map.set(`locatario-${i}`, {
        label: `Locatário: ${p.nome || p.razao_social || `Parte ${i + 1}`}`,
        rows: [],
      })
    );
    if (fiador) {
      const fLabel = fiador.nome || fiador.razao_social || "Fiador";
      map.set("fiador-0", { label: `Fiador: ${fLabel}`, rows: [] });
      if (fiador.tipo_pessoa !== "juridica" && hasDependente(fiador.conjuge)) {
        map.set("conjuge_fiador-0", {
          label: `Cônjuge do fiador ${fLabel}: ${fiador.conjuge.nome || "—"}`,
          rows: [],
        });
      }
    }
    locadores.forEach((p, i) =>
      map.set(`locador-${i}`, {
        label: `Locador: ${p.nome || p.razao_social || `Parte ${i + 1}`}`,
        rows: [],
      })
    );
    for (const job of displayJobs) {
      const key = groupKey(job);
      if (!map.has(key)) {
        // Diligenciados têm groupKey "diligenciado-N" — label amigável.
        // Dependentes do vendedor sem pré-seed (dado removido do form depois
        // do job criado) recebem rótulo legível em vez do enum cru.
        const n = job.targetIndex + 1;
        // Rótulo pelo catálogo de alvos (lib/certidoes/target-paths.ts) — cobre
        // os kinds de venda e de locação sem enum cru na tela.
        const label =
          job.targetKind === "diligenciado"
            ? `Diligência avulsa #${n}`
            : `${KIND_LABEL[job.targetKind] ?? job.targetKind} ${n}`;
        map.set(key, { label, rows: [] });
      }
      map.get(key)!.rows.push(job);
    }
    return Array.from(map.entries()).filter(([, g]) => g.rows.length > 0);
  }, [displayJobs, vendedores, compradores, imoveis, locatarios, locadores, fiador]);

  const stats = useMemo(() => {
    const total = visibleJobs.length;
    // Count by EFFECTIVE status (trusts resultData over job.status)
    const success = visibleJobs.filter(
      (j) => effectiveStatus(j) === "success"
    ).length;
    const failed = visibleJobs.filter(
      (j) => effectiveStatus(j) === "failed"
    ).length;
    const awaiting = visibleJobs.filter((j) => {
      const s = effectiveStatus(j);
      return s === "awaiting_portal" || s === "duplicate_pending";
    }).length;
    const fetching = visibleJobs.filter((j) => {
      const s = effectiveStatus(j);
      return s === "fetching" || s === "pending";
    }).length;
    const skipped = visibleJobs.filter(
      (j) => effectiveStatus(j) === "skipped"
    ).length;
    // "Precisa ação": estados terminais que dependem do usuário pra resolver.
    const actionNeeded = visibleJobs.filter((j) => {
      const s = effectiveStatus(j);
      return (
        s === "data_missing" ||
        s === "data_invalid" ||
        s === "failed_permanent" ||
        s === "skipped"
      );
    }).length;
    const stuck = visibleJobs.filter(isStuck).length;
    // Count ghost-data jobs: raw status says fetching/pending but data is valid.
    // These would be auto-promoted by sweeper or the UI already reads them as
    // success. Used to drive the "Recuperar travadas" UX.
    const ghostPromotable = visibleJobs.filter(
      (j) =>
        (j.status === "fetching" || j.status === "pending") &&
        hasValidResult(j)
    ).length;
    const cost = visibleJobs.reduce((a, j) => a + (j.costCents ?? 0), 0);
    const avgLatency = medianLatency(visibleJobs);
    return {
      total,
      success,
      failed,
      awaiting,
      fetching,
      skipped,
      actionNeeded,
      stuck,
      ghostPromotable,
      cost,
      avgLatency,
    };
  }, [visibleJobs]);

  const handleExtract = async (jobs?: JobSelection[]) => {
    if (extracting) return;
    setExtracting(true);
    try {
      const result = await extract(jobs);
      if (result?.requiresConsent) {
        // Guarda os jobs pra re-tentar após o usuário registrar o consent.
        setPendingConsentJobs(jobs ?? []);
        return;
      }
      if (result) {
        const dispatched = result.jobCount ?? 0;
        const inProg = result.skippedInProgress?.length ?? 0;
        const unmatched = result.unmatched?.length ?? 0;
        if (dispatched > 0 && inProg > 0) {
          toast.success(
            `Iniciando ${dispatched} certidão(ões) · ${inProg} já aguardando o tribunal`
          );
        } else if (dispatched > 0) {
          toast.success(`Iniciando ${dispatched} certidões…`);
        } else if (inProg > 0) {
          toast.info(
            `${inProg} certidão(ões) já em andamento — aguarde a conclusão`
          );
        }
        // Seleções que o plano atual não constrói (endpoint indisponível/gated):
        // foram ignoradas, não recusam mais o lote inteiro.
        if (unmatched > 0) {
          toast.info(
            `${unmatched} certidão(ões) indisponíveis no plano atual foram ignoradas`
          );
        }
      }
    } finally {
      setExtracting(false);
    }
  };

  // "Retentar erros" — re-dispara de uma vez todos os alvos com erro retentável
  // (sem saldo, instabilidade, divergência, falha). O backend pula sozinho os
  // que estiverem em andamento (skippedInProgress), então é seguro mandar tudo.
  const handleRetryErrors = async () => {
    if (extracting || retryableErrorJobs.length === 0) return;
    const sel: JobSelection[] = retryableErrorJobs.map((j) => ({
      endpoint: j.endpoint,
      targetKind: j.targetKind as JobSelection["targetKind"],
      targetIndex: j.targetIndex,
    }));
    await handleExtract(sel);
  };

  const handleReport = async () => {
    setGeneratingReport(true);
    try {
      const res = await fetch(`${apiBase}/report`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Falha ao gerar relatório");
        return;
      }
      toast.success("Relatório gerado");
      if (data.fileUrl) window.open(data.fileUrl, "_blank");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Falha ao gerar relatório"
      );
    } finally {
      setGeneratingReport(false);
    }
  };

  const handleDownloadZip = () => {
    window.location.href = `${apiBase}/zip`;
    toast.success("Baixando todas as certidões…");
  };

  const handleRetry = async (row: CertidaoJobRow) => {
    const result = await retry(row.id);
    if (!result.ok) {
      toast.error(result.error || "Erro ao tentar novamente");
      return;
    }
    toast.success("Tentativa iniciada");
  };

  /**
   * Phase G.2 — bulk retry por categoria de falha ou por status.
   * Chama POST /api/deals/:id/certidoes/bulk-retry primeiro em dry-run
   * (para confirmar com usuário) e depois dispara em modo real.
   */
  const handleBulkRetry = async (
    filter: { category?: string; status?: "failed" | "skipped" },
    label: string
  ) => {
    try {
      const dryRes = await fetch(
        `${apiBase}/bulk-retry`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...filter, dryRun: true }),
        }
      );
      const dryData = await dryRes.json();
      if (!dryRes.ok) {
        toast.error(dryData.error || "Erro no dry-run");
        return;
      }
      const retriable = dryData.retriable ?? 0;
      const skipped = dryData.skippedByRetry ?? 0;
      if (retriable === 0) {
        toast.info(
          `Nenhum job elegível para retry em "${label}"${
            skipped > 0 ? ` (${skipped} já atingiram MAX_RETRIES)` : ""
          }`
        );
        return;
      }
      if (
        !window.confirm(
          `Retry em massa: ${label}\n\n${retriable} job(s) serão re-executados.${
            skipped > 0 ? ` ${skipped} skipped por MAX_RETRIES.` : ""
          }\n\nConfirma? (custo adicional ≈ R$ ${(retriable * 0.05).toFixed(2).replace(".", ",")})`
        )
      ) {
        return;
      }
      const res = await fetch(
        `${apiBase}/bulk-retry`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(filter),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Erro no bulk retry");
        return;
      }
      toast.success(`${data.dispatched} job(s) disparados`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro inesperado");
    }
  };

  const handleSweep = async () => {
    // H.7 (Phase H, 2026-04-18) — dry-run via stats antes de executar; evita
    // ação silenciosa do QA anterior (botão clicado sem feedback visível).
    const stuck = stats.stuck;
    const promotable = stats.ghostPromotable;
    const willFail = Math.max(0, stuck - promotable);
    const confirmMsg =
      `Analisar ${Math.max(stuck, promotable)} job(s) travado(s):\n\n` +
      `• ${promotable} serão promovidos para sucesso (sem custo)\n` +
      `• ${willFail} serão marcados como falha e liberados para retry\n\n` +
      `Confirma?`;
    if (!window.confirm(confirmMsg)) return;
    const result = await sweepStale();
    if (result.promoted > 0 && result.failed > 0) {
      toast.success(
        `${result.promoted} já resolvida(s) promovida(s) para sucesso; ${result.failed} realmente falha(s) marcada(s)`
      );
    } else if (result.promoted > 0) {
      toast.success(
        `${result.promoted} certidão(ões) tinha(m) resultado válido no banco — visualização atualizada sem novas chamadas`
      );
    } else if (result.failed > 0) {
      toast.success(
        `${result.failed} certidão(ões) travada(s) marcada(s) como falha. Clique em tentar novamente em cada card.`
      );
    } else {
      toast.info("Nenhuma certidão travada encontrada");
    }
  };

  const handleDelete = async (
    row: CertidaoJobRow,
    opts?: { withAttachment?: boolean }
  ) => {
    setDeletingId(row.id);
    try {
      const ok = await deleteJob(row.id, opts);
      if (ok) {
        toast.success(
          opts?.withAttachment ? "Tentativa e documento removidos" : "Tentativa removida"
        );
      } else {
        toast.error("Falha ao remover");
      }
    } finally {
      setDeletingId(null);
    }
  };

  const handleBulkDelete = async (
    body: {
      scope: "status" | "batch" | "replaced" | "all_terminal";
      status?: string;
      batchId?: string;
      withAttachments?: boolean;
    },
    label: string
  ) => {
    if (
      !window.confirm(
        `Limpar: ${label}\n\nEsta ação remove as tentativas selecionadas${
          body.withAttachments ? " e os documentos ligados" : ""
        }. Continuar?`
      )
    ) {
      return;
    }
    setBulkDeleting(true);
    try {
      const result = await bulkDelete(body);
      if (!result) {
        toast.error("Falha ao limpar");
        return;
      }
      toast.success(
        `${result.deleted} tentativa(s) removida(s)${
          result.attachmentsDeleted > 0
            ? ` · ${result.attachmentsDeleted} documento(s)`
            : ""
        }`
      );
    } finally {
      setBulkDeleting(false);
    }
  };

  const hasJobs = visibleJobs.length > 0;

  return (
    <div className="space-y-4">
      {/* F3: diligenciados section at the top (negócio; a proposta não tem DiligentedPerson) */}
      {!isProposal && (
      <DiligentedPersonsSection
        dealId={dealId}
        parties={[
          ...vendedores.map((v) => ({
            kind: "vendedor",
            label: v.nome || v.razao_social || "Vendedor",
          })),
          ...compradores.map((c) => ({
            kind: "comprador",
            label: c.nome || c.razao_social || "Comprador",
          })),
          // Locação: quem está sendo diligenciado (mesma lista do seeding).
          ...locatarios.map((p) => ({
            kind: "locatario",
            label: p.nome || p.razao_social || "Locatário",
          })),
          ...(fiador
            ? [
                { kind: "fiador", label: fiador.nome || fiador.razao_social || "Fiador" },
                ...(fiador.tipo_pessoa !== "juridica" && hasDependente(fiador.conjuge)
                  ? [{ kind: "conjuge_fiador", label: fiador.conjuge.nome || "Cônjuge do fiador" }]
                  : []),
              ]
            : []),
          ...locadores.map((p) => ({
            kind: "locador",
            label: p.nome || p.razao_social || "Locador",
          })),
          ...imoveis.map((im, i) => ({
            kind: "imovel",
            label: imovelLabel(im, i),
          })),
        ]}
        onChange={() => refresh()}
      />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setDialogOpen(true)} disabled={extracting}>
          <Sparkles className="h-4 w-4 mr-1" />
          {hasJobs ? "Extrair novamente" : "Extrair certidões"}
        </Button>
        {hasJobs && (
          <Button variant="outline" onClick={() => refresh()}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Atualizar
          </Button>
        )}
        {retryableErrorJobs.length > 0 && (
          <Button
            variant="outline"
            onClick={handleRetryErrors}
            disabled={extracting}
            className="border-amber-300 text-amber-700 hover:bg-amber-50"
            title="Re-dispara de uma vez todos os alvos com erro (sem saldo, instabilidade, divergência). Os que estiverem em andamento são pulados automaticamente."
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Retentar erros ({retryableErrorJobs.length})
          </Button>
        )}
        {(stats.stuck > 0 || stats.ghostPromotable > 0) && (
          <Button
            variant="outline"
            onClick={handleSweep}
            className="border-amber-300 text-amber-700 hover:bg-amber-50"
            title={
              stats.ghostPromotable > 0
                ? `${stats.ghostPromotable} já têm resultado válido e serão promovidas sem custo`
                : "Marca como falha e libera botão de retry"
            }
          >
            <LifeBuoy className="h-4 w-4 mr-1" />
            Recuperar travadas ({Math.max(stats.stuck, stats.ghostPromotable)})
          </Button>
        )}
        {/* G.2 — bulk retry por categoria quando houver failed ou skipped */}
        {!isProposal && (stats.failed > 0 || stats.skipped > 0) && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex h-9 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-input bg-background px-3 text-sm font-medium shadow-xs ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Retentar em massa
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel className="text-xs">
                Por categoria de falha
              </DropdownMenuLabel>
              <DropdownMenuItem
                onSelect={() =>
                  handleBulkRetry(
                    { category: "portal_unavailable" },
                    "Portal indisponível"
                  )
                }
              >
                Portal indisponível
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  handleBulkRetry(
                    { category: "provider_timeout" },
                    "Timeout do provedor"
                  )
                }
              >
                Timeout do provedor
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  handleBulkRetry(
                    { category: "rate_limited" },
                    "Limite atingido"
                  )
                }
              >
                Limite atingido
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  handleBulkRetry(
                    { category: "integration_error" },
                    "Erro do sistema"
                  )
                }
              >
                Erro do sistema (nosso)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs">
                Por status
              </DropdownMenuLabel>
              {stats.failed > 0 && (
                <DropdownMenuItem
                  onSelect={() =>
                    handleBulkRetry({ status: "failed" }, `Todos failed (${stats.failed})`)
                  }
                >
                  Todos failed ({stats.failed})
                </DropdownMenuItem>
              )}
              {stats.skipped > 0 && (
                <DropdownMenuItem
                  onSelect={() =>
                    handleBulkRetry({ status: "skipped" }, `Todos skipped (${stats.skipped})`)
                  }
                >
                  Todos skipped ({stats.skipped})
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {hasJobs && !isProposal && (
          <Button
            variant={showAnalysis ? "default" : "outline"}
            onClick={() => setShowAnalysis((v) => !v)}
            title="Roda a análise das certidões e mostra apontamentos"
          >
            <Sparkles className="h-4 w-4 mr-1" />
            Análise IA
          </Button>
        )}
        {stats.success > 0 && (
          <>
            <Button
              variant="outline"
              onClick={handleReport}
              disabled={generatingReport}
            >
              <FileText className="h-4 w-4 mr-1" />
              {generatingReport ? "Gerando…" : "Gerar relatório"}
            </Button>
            {!isProposal && (
              <>
                <Button variant="outline" onClick={handleDownloadZip}>
                  <Download className="h-4 w-4 mr-1" />
                  Baixar todas (ZIP)
                </Button>
                <Button variant="outline" onClick={() => setShareOpen(true)}>
                  <Share2 className="h-4 w-4 mr-1" />
                  Compartilhar
                </Button>
              </>
            )}
          </>
        )}
        {hasJobs && (
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={bulkDeleting}
              className="inline-flex h-9 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-input bg-background px-3 text-sm font-medium text-destructive shadow-xs ring-offset-background transition-colors hover:bg-destructive/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Limpar
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel className="text-xs">
                Limpar lista
              </DropdownMenuLabel>
              {stats.failed > 0 && (
                <DropdownMenuItem
                  onSelect={() =>
                    handleBulkDelete(
                      { scope: "status", status: "failed" },
                      `Todas as falhas (${stats.failed})`
                    )
                  }
                >
                  Falhas ({stats.failed})
                </DropdownMenuItem>
              )}
              {stats.skipped > 0 && (
                <DropdownMenuItem
                  onSelect={() =>
                    handleBulkDelete(
                      { scope: "status", status: "skipped" },
                      `Todas as puladas (${stats.skipped})`
                    )
                  }
                >
                  Puladas ({stats.skipped})
                </DropdownMenuItem>
              )}
              {replacedCount > 0 && (
                <DropdownMenuItem
                  onSelect={() =>
                    handleBulkDelete(
                      { scope: "replaced" },
                      `Histórico de tentativas substituídas (${replacedCount})`
                    )
                  }
                >
                  Histórico/substituídas ({replacedCount})
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onSelect={() =>
                  handleBulkDelete(
                    { scope: "all_terminal" },
                    "Todas as tentativas finalizadas"
                  )
                }
              >
                Limpar todas (mantém só em andamento)
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onSelect={() =>
                  handleBulkDelete(
                    { scope: "all_terminal", withAttachments: true },
                    "Todas as tentativas + documentos"
                  )
                }
              >
                Limpar todas + documentos
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {replacedCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowHistory((v) => !v)}
            className="text-muted-foreground"
          >
            <Archive className="h-4 w-4 mr-1" />
            {showHistory ? "Ocultar histórico" : `Ver histórico (${replacedCount})`}
          </Button>
        )}
      </div>

      {/* D — Análise IA on-demand: só monta (e roda) quando o usuário abre. */}
      {showAnalysis && <CertidoesAnalysisPanel dealId={dealId} />}

      {hasAccountIssue && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex items-start gap-2">
          <Wallet className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            <strong>Emissão temporariamente indisponível.</strong> Algumas
            certidões não puderam ser emitidas agora por uma limitação do serviço
            de emissão (não é erro dos dados). Tente novamente em{" "}
            <strong>Retentar erros</strong> — o re-disparo é gratuito e não emite
            nada enquanto indisponível. Se persistir, contate o suporte.
          </span>
        </div>
      )}

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {hasJobs && (
        <Card>
          <CardContent className="py-3 flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <strong>{stats.success}</strong>/{stats.total} sucesso
            </div>
            {stats.failed > 0 && (
              <div className="flex items-center gap-1.5">
                <XCircle className="h-4 w-4 text-red-600" />
                <strong>{stats.failed}</strong> falhas
              </div>
            )}
            {stats.fetching > 0 && (
              <div className="flex items-center gap-1.5">
                <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
                <strong>{stats.fetching}</strong> em andamento
              </div>
            )}
            {stats.awaiting > 0 && (
              <div className="flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-amber-600" />
                <strong>{stats.awaiting}</strong> aguardando portal
              </div>
            )}
            {stats.skipped > 0 && (
              <div className="flex items-center gap-1.5">
                <SkipForward className="h-4 w-4 text-muted-foreground" />
                <strong>{stats.skipped}</strong> pulado(s)
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Wallet className="h-4 w-4" />R${" "}
              {(stats.cost / 100).toFixed(2).replace(".", ",")}
            </div>
            {stats.avgLatency > 0 && (
              <div className="text-muted-foreground">
                Latência média: {stats.avgLatency}s
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Filtros por status — facilita achar emitidas / pendências num deal
          com muitas partes. */}
      {hasJobs && (
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["all", `Todas (${stats.total})`],
              ["success", `Emitidas (${stats.success})`],
              ["awaiting", `Em andamento (${stats.awaiting + stats.fetching})`],
              ["action", `Precisa ação (${stats.actionNeeded})`],
              ["failed", `Falhas (${stats.failed})`],
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              size="sm"
              variant={statusFilter === key ? "default" : "outline"}
              onClick={() => setStatusFilter(key)}
              className="h-7 text-xs"
            >
              {label}
            </Button>
          ))}
        </div>
      )}

      {!hasJobs && !loading && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p>Nenhuma certidão extraída ainda.</p>
            <p className="text-xs mt-1">
              Clique em &ldquo;Extrair certidões&rdquo; para disparar via
              Infosimples.
            </p>
          </CardContent>
        </Card>
      )}

      {hasJobs && groups.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma certidão neste filtro.
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {groups.map(([key, group]) => {
          const collapsed = collapsedGroups.has(key);
          // Mini resumo por cor (régua) pra ver o grupo de relance recolhido.
          const tally = { green: 0, yellow: 0, red: 0, neutral: 0 };
          for (const r of group.rows) tally[colorTier(r)]++;
          return (
          <Card key={key}>
            <button
              type="button"
              onClick={() =>
                setCollapsedGroups((prev) => {
                  const next = new Set(prev);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                })
              }
              className="w-full flex items-center gap-2 px-6 py-4 text-left hover:bg-muted/30 rounded-t-lg"
            >
              {collapsed ? (
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <span className="text-sm font-semibold flex-1">{group.label}</span>
              <span className="flex items-center gap-2 text-xs tabular-nums">
                {tally.green > 0 && (
                  <span className="text-success">{tally.green}✓</span>
                )}
                {tally.yellow > 0 && (
                  <span className="text-warning">{tally.yellow}⏳</span>
                )}
                {tally.red > 0 && (
                  <span className="text-destructive">{tally.red}✗</span>
                )}
                {tally.neutral > 0 && (
                  <span className="text-muted-foreground">{tally.neutral}—</span>
                )}
              </span>
            </button>
            {!collapsed && (
            <CardContent className="space-y-2 pt-0">
              {group.rows.map((row) => {
                const resultData = row.resultData as
                  | { situacao?: string; validade?: string; emissao?: string }
                  | null;
                const validade = formatDateBR(resultData?.validade);
                const stuck = isStuck(row);
                const canRetry =
                  row.status === "failed" ||
                  stuck ||
                  row.status === "awaiting_portal" ||
                  (row.status === "success" && !row.attachmentId);
                // Alinhado com o backend (DELETABLE): qualquer estado terminal
                // pode ser excluído; só pending/fetching ficam de fora.
                const canDelete = ![
                  "pending",
                  "fetching",
                ].includes(row.status);
                const isComplementing = complementJobId === row.id;
                const skippedPayload =
                  row.status === "skipped"
                    ? (row.requestPayload as
                        | {
                            missingFields?: Array<{
                              path: string;
                              label: string;
                              type: string;
                              placeholder?: string;
                            }>;
                            externalLink?: string;
                          }
                        | null)
                    : null;
                const missingFields = skippedPayload?.missingFields ?? [];
                // G.3 — externalLink para portais que não têm cobertura Infosimples
                // (E-Proc SP, IPTU POA, etc). Renderiza botão abrindo nova aba.
                const externalLink = skippedPayload?.externalLink ?? null;
                return (
                  <div key={row.id} className="space-y-2">
                    <div
                      className={cn(
                        "rounded border p-2.5 flex items-start gap-2.5 text-sm cursor-pointer hover:shadow-xs transition-shadow",
                        statusVariant(row)
                      )}
                      onClick={(e) => {
                        // Avoid opening detail when clicking action buttons
                        const target = e.target as HTMLElement;
                        if (target.closest("button") || target.closest("a"))
                          return;
                        setDetailJob(row);
                      }}
                    >
                      <div className="shrink-0 mt-0.5">{statusIcon(row)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{row.label}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                          <span>{statusLabel(row)}</span>
                          {stuck && (
                            <span className="text-amber-700">(travada)</span>
                          )}
                          {(() => {
                            const cat = getFailureCategory(row);
                            if (!cat || cat === "genuine_no_data") return null;
                            return (
                              <Badge variant="outline" className="h-4 text-[10px] px-1 font-normal">
                                {CATEGORY_LABEL[cat]}
                              </Badge>
                            );
                          })()}
                        </div>
                        {(row.costCents != null ||
                          row.latencyMs != null ||
                          validade ||
                          row.retryCount > 0) && (
                          <div className="text-[10px] text-muted-foreground mt-0.5 flex gap-2 flex-wrap">
                            {row.costCents != null && row.costCents > 0 && (
                              <span>
                                R$ {(row.costCents / 100).toFixed(2).replace(".", ",")}
                              </span>
                            )}
                            {row.latencyMs != null && row.latencyMs > 0 && (
                              <span>{Math.round(row.latencyMs / 1000)}s</span>
                            )}
                            {validade && (
                              <span className="text-green-700">
                                Válida até {validade}
                              </span>
                            )}
                            {row.retryCount > 0 && (
                              <span>Retries: {row.retryCount}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDetailJob(row)}
                          className="h-7 px-2"
                          title="Ver detalhes"
                        >
                          <Eye className="h-3 w-3" />
                        </Button>
                        {row.attachmentId && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              asChild
                              className="h-7 px-2"
                              title="Abrir PDF"
                            >
                              <a
                                href={`${attachmentsBase}/${row.attachmentId}/file`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              asChild
                              className="h-7 px-2"
                              title="Baixar PDF"
                            >
                              <a
                                href={`${attachmentsBase}/${row.attachmentId}/file?download=1`}
                              >
                                <Download className="h-3 w-3" />
                              </a>
                            </Button>
                          </>
                        )}
                        {(row.status === "skipped" && missingFields.length > 0) ||
                        (row.status === "data_missing" &&
                          row.missingFields.length > 0) ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setComplementJobId(isComplementing ? null : row.id)
                            }
                            className="h-7 px-2 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                            title={
                              row.status === "data_missing"
                                ? `Complementar: ${row.missingFields.join(", ")}`
                                : "Complementar dados"
                            }
                          >
                            <FileText className="h-3 w-3" />
                          </Button>
                        ) : null}
                        {/* J.6 (Phase J) — "Abrir portal oficial" unificado:
                            aparece para skipped com externalLink legado OU
                            para qualquer status terminal não-sucesso quando o
                            job tem `portalUrl` (último recurso do catálogo). */}
                        {(() => {
                          const href = row.portalUrl ?? externalLink ?? null;
                          if (!href) return null;
                          const showForTerminalFailure =
                            row.status === "failed" ||
                            row.status === "failed_permanent" ||
                            row.status === "data_missing" ||
                            row.status === "data_invalid" ||
                            row.status === "duplicate_pending" ||
                            row.status === "skipped";
                          if (!showForTerminalFailure) return null;
                          return (
                            <Button
                              size="sm"
                              variant="ghost"
                              asChild
                              className="h-7 px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                              title={`Abrir portal oficial: ${href}`}
                            >
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </Button>
                          );
                        })()}
                        {(() => {
                          const cat = getFailureCategory(row);
                          if (!cat || !isUserFixable(cat)) return null;
                          if (row.targetKind === "imovel" || row.targetKind === "diligenciado") return null;
                          return (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingPartyJob(row)}
                              className="h-7 px-2 gap-1 text-amber-700 hover:bg-amber-50"
                              title="Corrigir os dados da parte e reenviar a certidão"
                            >
                              <AlertTriangle className="h-3 w-3" />
                              <span className="text-xs">Corrigir</span>
                            </Button>
                          );
                        })()}
                        {canRetry && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRetry(row)}
                            className="h-7 px-2"
                            title={
                              row.status === "awaiting_portal"
                                ? "Buscar agora no portal"
                                : row.status === "success"
                                ? "Re-baixar comprovante"
                                : "Tentar novamente"
                            }
                          >
                            {row.status === "awaiting_portal" ? (
                              <CalendarClock className="h-3 w-3" />
                            ) : (
                              <RefreshCw className="h-3 w-3" />
                            )}
                          </Button>
                        )}
                        {canDelete &&
                          (row.attachmentId ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                disabled={deletingId === row.id}
                                className="inline-flex h-7 items-center justify-center rounded-md px-2 text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50"
                                title="Remover"
                              >
                                <Trash2 className="h-3 w-3" />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuItem onSelect={() => handleDelete(row)}>
                                  Excluir tentativa
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onSelect={() =>
                                    handleDelete(row, { withAttachment: true })
                                  }
                                >
                                  Excluir tentativa + documento
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDelete(row)}
                              disabled={deletingId === row.id}
                              className="h-7 px-2 text-destructive hover:bg-destructive/10"
                              title="Remover"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          ))}
                      </div>
                    </div>
                    {isComplementing && missingFields.length > 0 && (
                      <ComplementDadosForm
                        missingFields={missingFields}
                        onCancel={() => setComplementJobId(null)}
                        onSubmit={async (fields) => {
                          const result = await completeSkipped(row.id, fields);
                          if (!result.ok) {
                            toast.error(result.error || "Erro ao complementar");
                            return;
                          }
                          toast.success("Dados complementados — consultando…");
                          setComplementJobId(null);
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </CardContent>
            )}
          </Card>
          );
        })}
      </div>

      <ExtractCertidoesDialog
        key={certKey}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        dealId={dealId}
        extractedStatus={extractedStatus}
        inProgressKeys={inProgressKeys}
        onConfirm={handleExtract}
        onAddPerson={isProposal ? undefined : () => setAddPersonOpen(true)}
        esteira={esteira}
        planUrl={`${apiBase}/plan`}
        subject={subject}
      />

      <DiligentedPersonDialog
        dealId={dealId}
        open={addPersonOpen}
        onOpenChange={setAddPersonOpen}
        onCreated={() => {
          setAddPersonOpen(false);
          setCertKey((k) => k + 1); // remonta a popup → recarrega o plano
        }}
      />

      <SerasaConsentDialog
        open={pendingConsentJobs !== null}
        onOpenChange={(open) => !open && setPendingConsentJobs(null)}
        dealId={dealId}
        onGranted={async () => {
          const jobs = pendingConsentJobs;
          setPendingConsentJobs(null);
          if (jobs) {
            await handleExtract(jobs);
          }
        }}
      />

      {detailJob && (
        <CertidaoDetailDialog
          job={detailJob}
          dealId={dealId}
          attachmentsBase={attachmentsBase}
          open={!!detailJob}
          onOpenChange={(open) => !open && setDetailJob(null)}
          onRetry={() => handleRetry(detailJob)}
          onDelete={() => handleDelete(detailJob)}
        />
      )}

      {editingPartyJob && (
        <EditPartyDialog
          job={editingPartyJob}
          dealId={dealId}
          esteira={esteira}
          apiBase={apiBase}
          dataUrl={dataUrl}
          open={!!editingPartyJob}
          onOpenChange={(open) => !open && setEditingPartyJob(null)}
          onSaved={async () => {
            // After the party data is updated, retry the failing job so it
            // consumes the fresh snapshot from the re-planner.
            const job = editingPartyJob;
            setEditingPartyJob(null);
            if (job) {
              await handleRetry(job);
              toast.success("Dados atualizados — consultando novamente…");
            }
          }}
        />
      )}

      <ShareCertidoesDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        dealId={dealId}
      />
    </div>
  );
}
