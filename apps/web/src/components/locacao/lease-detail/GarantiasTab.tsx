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
import { Field } from "./LeaseSection";
import { FileCheck, FileText, Upload, History } from "lucide-react";
import {
  GARANTIA_TIPO_LABELS,
  GUARANTEE_STATUS_LABELS,
  GUARANTEE_STATUSES,
} from "@/lib/locacao/validators";
import { ContratarGarantiaDialog } from "./ContratarGarantiaDialog";

export interface GuaranteeView {
  id: string;
  tipo: string;
  caucaoSubtipo: string | null;
  provider: string | null;
  status: string;
  coberturaMeses: number | null;
  custoJson: unknown;
  dadosJson: unknown;
  fiadorPartyJson: unknown;
  externalRef: string | null;
  documentoPdfUrl: string | null;
  historicoJson: unknown;
  updatedAt: string;
}

interface Props {
  leaseContractId: string;
  valorAluguel: number;
  guarantee: GuaranteeView | null;
}

const STATUS_TONE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pendente: "secondary",
  em_analise: "secondary",
  aprovada: "default",
  vigente: "default",
  ativa: "default",
  executada: "destructive",
  acionada: "destructive",
  finalizada: "outline",
  encerrada: "outline",
  recusada: "destructive",
};

// Status selecionáveis na UI = só o lifecycle novo (legados aparecem mapeados).
const SELECTABLE_STATUSES = GUARANTEE_STATUSES.filter(
  (s) => !["ativa", "acionada", "encerrada", "recusada"].includes(s)
);

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type Fiador = {
  nome?: string;
  cpf?: string;
  telefone?: string;
  email?: string;
  endereco?: string;
  profissao?: string;
  rendaMensal?: number;
};

type HistoricoEntry = {
  snapshot?: { tipo?: string; provider?: string | null; status?: string };
  substituidaEm?: string;
};

export function GarantiasTab({ leaseContractId, valorAluguel, guarantee }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fiador = (guarantee?.fiadorPartyJson ?? null) as Fiador | null;
  const dados = (guarantee?.dadosJson ?? {}) as Record<string, unknown>;
  const custo = (guarantee?.custoJson ?? {}) as Record<string, unknown>;
  const historico = (
    Array.isArray(guarantee?.historicoJson) ? guarantee?.historicoJson : []
  ) as HistoricoEntry[];

  async function patchStatus(status: string) {
    if (!guarantee) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/locacao/guarantees/${guarantee.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success(`Status: ${GUARANTEE_STATUS_LABELS[status] ?? status}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setBusy(false);
    }
  }

  async function uploadDocumento(file: File) {
    if (!guarantee) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/locacao/guarantees/${guarantee.id}/document`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success("Documento anexado");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro no upload");
    } finally {
      setBusy(false);
    }
  }

  const custoMensal =
    typeof custo.premioMensal === "number"
      ? custo.premioMensal
      : typeof custo.taxaMensal === "number"
        ? custo.taxaMensal
        : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <FileCheck className="h-4 w-4" /> Garantia locatícia
        </h3>
        <ContratarGarantiaDialog
          leaseContractId={leaseContractId}
          valorAluguel={valorAluguel}
          substituicao={Boolean(guarantee)}
        />
      </div>

      {!guarantee ? (
        <Card>
          <CardContent className="py-10 text-center">
            <FileCheck className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              Contrato sem garantia formal. A Lei 8.245 (art. 37) admite caução, fiador,
              seguro-fiança ou cessão fiduciária — apenas uma modalidade por contrato.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">
                  {GARANTIA_TIPO_LABELS[guarantee.tipo] ?? guarantee.tipo}
                  {guarantee.provider && (
                    <span className="ml-2 text-sm text-muted-foreground">
                      · {guarantee.provider}
                    </span>
                  )}
                </p>
                {guarantee.externalRef && (
                  <p className="text-xs text-muted-foreground">ref. {guarantee.externalRef}</p>
                )}
              </div>
              <Badge variant={STATUS_TONE[guarantee.status] ?? "outline"}>
                {GUARANTEE_STATUS_LABELS[guarantee.status] ?? guarantee.status}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
              {guarantee.coberturaMeses && (
                <Field label="Cobertura" value={`${guarantee.coberturaMeses} meses`} />
              )}
              {custoMensal !== null && (
                <Field label="Custo mensal" value={fmtBRL(custoMensal)} />
              )}
              {guarantee.caucaoSubtipo && (
                <Field label="Subtipo caução" value={guarantee.caucaoSubtipo} />
              )}
              {typeof dados.valorCaucao === "number" && (
                <Field label="Valor caução" value={fmtBRL(dados.valorCaucao)} />
              )}
              {typeof dados.valorTitulo === "number" && (
                <Field label="Valor do título" value={fmtBRL(dados.valorTitulo)} />
              )}
              {typeof dados.valorCedido === "number" && (
                <Field label="Valor cedido" value={fmtBRL(dados.valorCedido)} />
              )}
            </div>

            {fiador?.nome && (
              <div className="rounded-md border p-3">
                <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                  Fiador
                </p>
                <p className="text-sm font-medium">{fiador.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {[
                    fiador.cpf && `CPF ${fiador.cpf}`,
                    fiador.telefone,
                    fiador.email,
                    fiador.profissao,
                    typeof fiador.rendaMensal === "number" &&
                      `renda ${fmtBRL(fiador.rendaMensal)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Sem dados complementares"}
                </p>
                {fiador.endereco && (
                  <p className="text-xs text-muted-foreground">{fiador.endereco}</p>
                )}
              </div>
            )}

            {typeof dados.observacoes === "string" && dados.observacoes && (
              <p className="text-sm text-muted-foreground">{dados.observacoes}</p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Select value={guarantee.status} onValueChange={patchStatus} disabled={busy}>
                <SelectTrigger className="h-8 w-[160px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SELECTABLE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {GUARANTEE_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {guarantee.documentoPdfUrl && (
                <Button asChild size="sm" variant="outline">
                  <a href={guarantee.documentoPdfUrl} target="_blank" rel="noreferrer">
                    <FileText className="mr-1.5 h-3.5 w-3.5" /> Ver documento
                  </a>
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                {guarantee.documentoPdfUrl ? "Substituir documento" : "Anexar documento (PDF)"}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadDocumento(f);
                  e.target.value = "";
                }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {historico.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
              <History className="h-3.5 w-3.5" /> Garantias anteriores ({historico.length})
            </p>
            <ul className="divide-y text-sm">
              {historico
                .slice()
                .reverse()
                .map((h, i) => (
                  <li key={i} className="flex items-center justify-between py-2">
                    <span>
                      {GARANTIA_TIPO_LABELS[h.snapshot?.tipo ?? ""] ?? h.snapshot?.tipo ?? "—"}
                      {h.snapshot?.provider && (
                        <span className="text-muted-foreground"> · {h.snapshot.provider}</span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      substituída em{" "}
                      {h.substituidaEm
                        ? new Date(h.substituidaEm).toLocaleDateString("pt-BR")
                        : "—"}
                    </span>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
