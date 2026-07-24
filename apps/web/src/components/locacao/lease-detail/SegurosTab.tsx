"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Shield, FileText, Upload, Trash2, AlertTriangle, ExternalLink } from "lucide-react";
import Link from "next/link";
import { INSURANCE_STATUS_LABELS } from "@/lib/locacao/validators";
import { ContratarSeguroWizard } from "./ContratarSeguroWizard";
import { FiancaComparativoCard, type FiancaConsolidado } from "./FiancaComparativoCard";

export interface PolicyView {
  id: string;
  tipo: string;
  seguradora: string;
  apoliceNumero: string | null;
  vigenciaInicio: string;
  vigenciaFim: string;
  premioMensal: number | null;
  responsavelPagamento: string | null;
  status: string;
  pdfUrl: string | null;
  coberturaJson: unknown;
}

interface Props {
  leaseContractId: string;
  valorAluguel: number;
  policies: PolicyView[];
  /** Comparativo consolidado de fiança (Guarantee.dadosJson gravado pelo Max). Opcional. */
  fiancaConsolidado?: FiancaConsolidado | null;
}

const TIPO_LABEL: Record<string, string> = {
  seguro_incendio: "Incêndio",
  seguro_fianca: "Fiança",
  conteudo: "Conteúdo",
  rd: "RD",
};

const STATUS_TONE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  cotacao: "secondary",
  em_analise: "secondary",
  pendente: "secondary",
  ativa: "default",
  vencida: "destructive",
  cancelada: "outline",
};

const COBERTURA_LABEL: Record<string, string> = {
  incendio: "Incêndio",
  raio: "Raio",
  explosao: "Explosão",
  vendaval: "Vendaval",
  danos_eletricos: "Danos elétricos",
  responsabilidade_civil: "RC",
  perda_aluguel: "Perda de aluguel",
};

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDate(iso: string): string {
  // Vigências são date-only (UTC meia-noite) — sem timeZone UTC o display
  // desliza um dia em UTC-3 (memória feedback_date_parse_timezone).
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function coberturaResumo(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as { coberturaValor?: number; basicas?: string[]; adicionais?: string[] };
  const partes: string[] = [];
  if (c.coberturaValor) partes.push(fmtBRL(c.coberturaValor));
  const cobs = [...(c.basicas ?? []), ...(c.adicionais ?? [])]
    .map((k) => COBERTURA_LABEL[k] ?? k)
    .join(", ");
  if (cobs) partes.push(cobs);
  return partes.length ? partes.join(" · ") : null;
}

function PolicyCard({ policy }: { policy: PolicyView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const venceEm = Math.ceil(
    (new Date(policy.vigenciaFim).getTime() - Date.now()) / (24 * 3600_000)
  );
  const alertaVencimento = policy.status === "ativa" && venceEm >= 0 && venceEm <= 30;

  async function patchStatus(status: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/locacao/insurance/${policy.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success(`Status atualizado para ${INSURANCE_STATUS_LABELS[status] ?? status}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setBusy(false);
    }
  }

  async function uploadPdf(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/locacao/insurance/${policy.id}/pdf`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success("Apólice anexada");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro no upload");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Excluir esta cotação?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/locacao/insurance/${policy.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success("Cotação excluída");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setBusy(false);
    }
  }

  const cobertura = coberturaResumo(policy.coberturaJson);

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-medium">
              {policy.seguradora} — {TIPO_LABEL[policy.tipo] ?? policy.tipo}
              {policy.apoliceNumero && (
                <span className="ml-2 text-xs text-muted-foreground">
                  apólice {policy.apoliceNumero}
                </span>
              )}
            </p>
            <p className="text-sm text-muted-foreground">
              {fmtDate(policy.vigenciaInicio)} → {fmtDate(policy.vigenciaFim)}
              {policy.premioMensal ? ` · ${fmtBRL(policy.premioMensal)}/mês` : ""}
              {policy.responsavelPagamento ? ` · paga: ${policy.responsavelPagamento}` : ""}
            </p>
            {cobertura && <p className="text-xs text-muted-foreground">{cobertura}</p>}
          </div>
          <Badge variant={STATUS_TONE[policy.status] ?? "outline"}>
            {INSURANCE_STATUS_LABELS[policy.status] ?? policy.status}
          </Badge>
        </div>

        {alertaVencimento && (
          <p className="flex items-center gap-1.5 text-xs text-amber-600">
            <AlertTriangle className="h-3.5 w-3.5" />
            Vence em {venceEm} dia(s) — providencie a renovação.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Select value={policy.status} onValueChange={patchStatus} disabled={busy}>
            <SelectTrigger className="h-8 w-[150px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(INSURANCE_STATUS_LABELS).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {policy.pdfUrl ? (
            <Button asChild size="sm" variant="outline">
              <a href={policy.pdfUrl} target="_blank" rel="noreferrer">
                <FileText className="mr-1.5 h-3.5 w-3.5" /> Ver apólice
              </a>
            </Button>
          ) : null}

          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            {policy.pdfUrl ? "Substituir PDF" : "Anexar apólice (PDF)"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadPdf(f);
              e.target.value = "";
            }}
          />

          {policy.status === "cotacao" && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={remove}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Excluir
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function SegurosTab({ leaseContractId, valorAluguel, policies, fiancaConsolidado }: Props) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <Shield className="h-4 w-4" /> Seguros do contrato
        </h3>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="ghost">
            <Link href="/locacao/seguros">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Carteira de seguros
            </Link>
          </Button>
          <ContratarSeguroWizard leaseContractId={leaseContractId} valorAluguel={valorAluguel} />
        </div>
      </div>

      {fiancaConsolidado && <FiancaComparativoCard consolidado={fiancaConsolidado} />}

      {policies.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <Shield className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              Nenhum seguro neste contrato. O seguro incêndio é exigido na maioria das
              locações (Lei 8.245 art. 22) — contrate pela cotação guiada.
            </p>
          </CardContent>
        </Card>
      ) : (
        policies.map((p) => <PolicyCard key={p.id} policy={p} />)
      )}
    </div>
  );
}
