"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Code2,
  Undo2,
  Loader2,
  Trash2,
  Home,
} from "lucide-react";
import { buildColumnRuler } from "@/lib/dimob/decode";

export interface LeaseMonthCell {
  month: number; // 1..12
  aluguel: number;
  comissao: number;
  imposto: number;
  aluguelOverridden?: boolean;
  comissaoOverridden?: boolean;
  impostoOverridden?: boolean;
}

export interface LeaseReviewRecord {
  recordId: string;
  leaseId: string;
  kind: "R02";
  title: string;
  locador: { nome: string; cpfCnpj: string; tipoPessoa: string };
  locatario: { nome: string; cpfCnpj: string };
  imovel: { endereco: string | null; cep: string | null; uf: string | null; tipoImovel: string | null };
  numeroContrato: string | null;
  dataContrato: string | null;
  meses: LeaseMonthCell[];
  totais: { aluguel: number; comissao: number; imposto: number };
  raw: string;
  recordIssues: { level: "error" | "warning"; field: string; message: string }[];
  overridden: boolean;
}

const MONTHS_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const fmt = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cpfCnpjMask = (d: string) =>
  !d
    ? "—"
    : d.length === 14
      ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
      : d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");

type Column = "aluguel" | "comissao" | "imposto";

function MoneyCell({
  recordId,
  fieldKey,
  value,
  overridden,
  saving,
  onCommit,
  onReset,
}: {
  recordId: string;
  fieldKey: string;
  value: number;
  overridden: boolean;
  saving: boolean;
  onCommit: (recordId: string, fieldKey: string, value: string) => void;
  onReset: (recordId: string, fieldKey: string) => void;
}) {
  const display = fmt(value);
  const [val, setVal] = useState(display);
  useEffect(() => setVal(display), [display]);

  const commit = () => {
    if (val.trim() !== display) onCommit(recordId, fieldKey, val.trim());
  };

  return (
    <div className="flex items-center gap-1">
      <Input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        inputMode="decimal"
        className={`h-7 w-24 text-right font-mono text-xs ${overridden ? "border-primary/60" : ""}`}
      />
      {saving ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
      ) : overridden ? (
        <button
          type="button"
          title="Desfazer edição"
          className="shrink-0 text-primary hover:text-primary/70"
          onClick={() => onReset(recordId, fieldKey)}
        >
          <Undo2 className="h-3 w-3" />
        </button>
      ) : (
        <span className="w-3 shrink-0" />
      )}
    </div>
  );
}

/** id do DOM de um card de locação — usado pelo deep-link (scroll/realce). */
export const dimobLeaseDomId = (recordId: string) =>
  `dimob-rec-${recordId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

export interface DimobLeaseCardProps {
  record: LeaseReviewRecord;
  editable?: boolean;
  savingKeys?: Set<string>;
  selected?: boolean;
  onToggleSelect?: (record: LeaseReviewRecord) => void;
  onCommit: (recordId: string, fieldKey: string, value: string) => void;
  onReset: (recordId: string, fieldKey: string) => void;
  onExcludeLease: (record: LeaseReviewRecord) => void;
  highlightRecordId?: string | null;
}

export function DimobLeaseCard({
  record,
  editable,
  savingKeys,
  selected,
  onToggleSelect,
  onCommit,
  onReset,
  onExcludeLease,
  highlightRecordId,
}: DimobLeaseCardProps) {
  const [open, setOpen] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [flash, setFlash] = useState(false);
  const errors = record.recordIssues.filter((i) => i.level === "error").length;
  const warnings = record.recordIssues.filter((i) => i.level === "warning").length;

  useEffect(() => {
    if (highlightRecordId !== record.recordId) return;
    setOpen(true);
    setFlash(true);
    document
      .getElementById(dimobLeaseDomId(record.recordId))
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setFlash(false), 2000);
    return () => clearTimeout(t);
  }, [highlightRecordId, record.recordId]);

  const cols: { key: Column; label: string; fieldPrefix: string; overKey: keyof LeaseMonthCell }[] = [
    { key: "aluguel", label: "Aluguel", fieldPrefix: "aluguel", overKey: "aluguelOverridden" },
    { key: "comissao", label: "Comissão", fieldPrefix: "comissao", overKey: "comissaoOverridden" },
    { key: "imposto", label: "IRRF", fieldPrefix: "imposto", overKey: "impostoOverridden" },
  ];

  return (
    <Card
      id={dimobLeaseDomId(record.recordId)}
      className={flash ? "ring-2 ring-primary ring-offset-2 transition-shadow" : "transition-shadow"}
    >
      <CardHeader className="py-3">
        <div className="flex items-center gap-2">
          {onToggleSelect && (
            <Checkbox
              checked={selected}
              onCheckedChange={() => onToggleSelect(record)}
              onClick={(e) => e.stopPropagation()}
              aria-label="Selecionar contrato"
            />
          )}
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
            <Badge variant="outline" className="shrink-0 font-mono">R02</Badge>
            <span className="truncate text-sm font-medium">{record.title}</span>
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {record.overridden && <Badge variant="secondary">editado</Badge>}
            {errors > 0 && <Badge variant="destructive">{errors} bloqueio{errors > 1 ? "s" : ""}</Badge>}
            {warnings > 0 && <Badge variant="secondary">{warnings} aviso{warnings > 1 ? "s" : ""}</Badge>}
            {errors === 0 && warnings === 0 && (
              <Badge variant="secondary" className="text-emerald-600">ok</Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
              onClick={() => onExcludeLease(record)}
              title="Excluir este contrato da DIMOB"
            >
              <Trash2 className="h-3.5 w-3.5" /> Excluir
            </Button>
          </div>
        </div>
        {/* Metadados sempre visíveis (contexto do locador/imóvel) */}
        <div className="ml-6 flex flex-wrap gap-x-4 gap-y-0.5 pt-1 text-[11px] text-muted-foreground">
          <span>Locador: {cpfCnpjMask(record.locador.cpfCnpj)}</span>
          <span>Locatário: {cpfCnpjMask(record.locatario.cpfCnpj)}</span>
          {record.imovel.endereco && (
            <span className="inline-flex items-center gap-1">
              <Home className="h-3 w-3" /> {record.imovel.endereco}
              {record.imovel.uf ? `/${record.imovel.uf}` : ""}
            </span>
          )}
          {record.dataContrato && (
            <span>Contrato desde {record.dataContrato.split("-").reverse().join("/")}</span>
          )}
          <span className="font-medium text-foreground">
            Total ano: {fmt(record.totais.aluguel)}
          </span>
        </div>
      </CardHeader>

      {open && (
        <CardContent className="space-y-3 pt-0">
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5">Mês</th>
                  {cols.map((c) => (
                    <th key={c.key} className="px-2 py-1.5 text-right">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {record.meses.map((m) => (
                  <tr key={m.month} className="border-b last:border-0">
                    <td className="px-2 py-1 text-xs font-medium text-muted-foreground">
                      {MONTHS_PT[m.month - 1]}
                    </td>
                    {cols.map((c) => {
                      const fieldKey = `${c.fieldPrefix}_${m.month}`;
                      const over = Boolean(m[c.overKey]);
                      const saving = savingKeys?.has(`${record.recordId}:${fieldKey}`) ?? false;
                      return (
                        <td key={c.key} className="px-2 py-1 text-right">
                          {editable ? (
                            <MoneyCell
                              recordId={record.recordId}
                              fieldKey={fieldKey}
                              value={m[c.key]}
                              overridden={over}
                              saving={saving}
                              onCommit={onCommit}
                              onReset={onReset}
                            />
                          ) : (
                            <span className="font-mono text-xs">{fmt(m[c.key])}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t font-medium">
                <tr>
                  <td className="px-2 py-1.5 text-xs">Total</td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs">{fmt(record.totais.aluguel)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs">{fmt(record.totais.comissao)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs">{fmt(record.totais.imposto)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {record.recordIssues.length > 0 && (
            <div className="space-y-1 text-xs">
              {record.recordIssues.map((i, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  <span className="text-muted-foreground">{i.message}</span>
                </div>
              ))}
            </div>
          )}

          <div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => setShowRaw((v) => !v)}
            >
              <Code2 className="h-3.5 w-3.5" />
              {showRaw ? "Ocultar" : "Ver"} linha bruta (largura fixa)
            </Button>
            {showRaw && (
              <div className="mt-2 overflow-x-auto rounded-md border bg-muted/40 p-3">
                <pre className="whitespace-pre font-mono text-[11px] leading-4 text-muted-foreground">
                  {buildColumnRuler(record.raw.length)}
                </pre>
                <pre className="whitespace-pre font-mono text-[11px] leading-4">{record.raw}</pre>
              </div>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">
              O TXT final soma todos os contratos deste locador em uma única linha R02.
            </p>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
