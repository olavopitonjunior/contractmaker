"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronDown,
  ChevronRight,
  Check,
  AlertTriangle,
  XCircle,
  Code2,
  Undo2,
  Loader2,
} from "lucide-react";
import { buildColumnRuler } from "@/lib/dimob/decode";

export type CellStatus = "ok" | "warning" | "error";

export interface ReviewCell {
  key: string;
  label: string;
  start: number;
  end: number;
  length: number;
  type: string;
  required: boolean;
  value: string;
  rawSlice: string;
  editable: boolean;
  origin: string | null;
  status: CellStatus;
  statusMessage: string | null;
  overridden?: boolean;
  originalValue?: string | null;
}

export interface ReviewRecord {
  recordId: string;
  kind: string;
  title: string;
  dealId: string | null;
  cells: ReviewCell[];
  raw: string;
  recordIssues: { level: "error" | "warning"; field: string; message: string }[];
}

/** Campos R04 que mapeiam a um campo do contrato ("corrigir na origem"). */
const CONTRACT_MAPPABLE = new Set([
  "nomeComprador",
  "cpfCnpjComprador",
  "nomeVendedor",
  "cpfCnpjVendedor",
  "valorAlienacao",
  "enderecoImovel",
  "cepImovel",
  "ufImovel",
  "numeroContrato",
]);

export interface DimobRecordGridProps {
  records: ReviewRecord[];
  editable?: boolean;
  savingKeys?: Set<string>; // `${recordId}:${fieldKey}`
  onCommit?: (recordId: string, fieldKey: string, value: string) => void;
  onReset?: (recordId: string, fieldKey: string) => void;
  onCorrigirOrigem?: (record: ReviewRecord, cell: ReviewCell) => void;
}

function StatusIcon({ status }: { status: CellStatus }) {
  if (status === "error") return <XCircle className="h-4 w-4 text-destructive" />;
  if (status === "warning") return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  return <Check className="h-4 w-4 text-emerald-500" />;
}

function summarize(cells: ReviewCell[]) {
  let errors = 0;
  let warnings = 0;
  for (const c of cells) {
    if (c.status === "error") errors++;
    else if (c.status === "warning") warnings++;
  }
  return { errors, warnings };
}

function RawLine({ raw }: { raw: string }) {
  const ruler = buildColumnRuler(raw.length);
  return (
    <div className="overflow-x-auto rounded-md border bg-muted/40 p-3">
      <pre className="font-mono text-[11px] leading-4 whitespace-pre text-muted-foreground">{ruler}</pre>
      <pre className="font-mono text-[11px] leading-4 whitespace-pre">{raw}</pre>
    </div>
  );
}

function EditableValue({
  record,
  cell,
  saving,
  onCommit,
  onReset,
  onCorrigirOrigem,
}: {
  record: ReviewRecord;
  cell: ReviewCell;
  saving: boolean;
  onCommit: (recordId: string, fieldKey: string, value: string) => void;
  onReset: (recordId: string, fieldKey: string) => void;
  onCorrigirOrigem?: (record: ReviewRecord, cell: ReviewCell) => void;
}) {
  const [val, setVal] = useState(cell.value);
  // ressincroniza quando o servidor devolve novo valor (após salvar/reset)
  useEffect(() => setVal(cell.value), [cell.value]);

  const commit = () => {
    if (val !== cell.value) onCommit(record.recordId, cell.key, val);
  };

  const borderClass =
    cell.status === "error"
      ? "border-destructive/60"
      : cell.status === "warning"
        ? "border-amber-400/60"
        : "";

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className={`h-8 font-mono text-sm ${borderClass}`}
        />
        {saving && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
      </div>
      {cell.overridden && (
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          era:{" "}
          <span className="font-mono line-through">{cell.originalValue || "vazio"}</span>
          <button
            type="button"
            className="ml-0.5 inline-flex items-center gap-0.5 text-primary hover:underline"
            onClick={() => onReset(record.recordId, cell.key)}
          >
            <Undo2 className="h-3 w-3" /> desfazer
          </button>
        </div>
      )}
      {onCorrigirOrigem && record.kind === "R04" && CONTRACT_MAPPABLE.has(cell.key) && (
        <button
          type="button"
          className="text-[11px] text-primary hover:underline"
          onClick={() => onCorrigirOrigem(record, cell)}
        >
          corrigir no contrato →
        </button>
      )}
    </div>
  );
}

function RecordCard({
  record,
  editable,
  savingKeys,
  onCommit,
  onReset,
  onCorrigirOrigem,
}: { record: ReviewRecord } & Omit<DimobRecordGridProps, "records">) {
  const [open, setOpen] = useState(record.kind === "R01");
  const [showRaw, setShowRaw] = useState(false);
  const { errors, warnings } = summarize(record.cells);

  return (
    <Card>
      <CardHeader className="cursor-pointer select-none py-3" onClick={() => setOpen((v) => !v)}>
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <Badge variant="outline" className="shrink-0 font-mono">{record.kind}</Badge>
          <span className="truncate text-sm font-medium">{record.title}</span>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {errors > 0 && <Badge variant="destructive">{errors} bloqueio{errors > 1 ? "s" : ""}</Badge>}
            {warnings > 0 && <Badge variant="secondary">{warnings} aviso{warnings > 1 ? "s" : ""}</Badge>}
            {errors === 0 && warnings === 0 && (
              <Badge variant="secondary" className="text-emerald-600">ok</Badge>
            )}
          </div>
        </div>
      </CardHeader>

      {open && (
        <CardContent className="space-y-3 pt-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5">Campo</th>
                  <th className="px-2 py-1.5 w-[38%]">Valor</th>
                  <th className="px-2 py-1.5 whitespace-nowrap">Posição</th>
                  <th className="px-2 py-1.5 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {record.cells
                  .filter((c) => c.type !== "reserved")
                  .map((c) => {
                    const saving = savingKeys?.has(`${record.recordId}:${c.key}`) ?? false;
                    return (
                      <tr key={c.key} className="border-b last:border-0 align-top">
                        <td className="px-2 py-1.5">
                          <div className="font-medium">
                            {c.label}
                            {c.required && <span className="ml-0.5 text-destructive">*</span>}
                          </div>
                          {c.origin && <div className="text-[11px] text-muted-foreground">{c.origin}</div>}
                        </td>
                        <td className="px-2 py-1.5">
                          {editable && c.editable && onCommit && onReset ? (
                            <EditableValue
                              record={record}
                              cell={c}
                              saving={saving}
                              onCommit={onCommit}
                              onReset={onReset}
                              onCorrigirOrigem={onCorrigirOrigem}
                            />
                          ) : c.type === "const" ? (
                            <span className="font-mono text-muted-foreground">{c.value}</span>
                          ) : c.value ? (
                            <span className="font-mono">{c.value}</span>
                          ) : (
                            <span className="italic text-muted-foreground">vazio</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                          {c.start}–{c.end} · {c.length}
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center justify-center" title={c.statusMessage ?? undefined}>
                            <StatusIcon status={c.status} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
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
              <div className="mt-2">
                <RawLine raw={record.raw} />
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export function DimobRecordGrid({ records, ...handlers }: DimobRecordGridProps) {
  if (!records.length) return null;
  return (
    <div className="space-y-2">
      {records.map((r) => (
        <RecordCard key={r.recordId} record={r} {...handlers} />
      ))}
    </div>
  );
}
