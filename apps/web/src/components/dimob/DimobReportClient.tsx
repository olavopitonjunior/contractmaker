"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Download, FileText, Loader2 } from "lucide-react";

interface Party {
  nome: string;
  cpfCnpj: string;
}
interface DimobRecord {
  dealId: string;
  dealTitle: string;
  comprador: Party;
  vendedor: Party;
  dataOperacao: string;
  valorAlienacao: number;
  valorComissao: number;
  commissionSource: string;
  needsReview: boolean;
  imovel: { endereco: string | null; uf: string | null };
}
interface Issue {
  level: "error" | "warning";
  scope: "declarante" | "operacao";
  field: string;
  message: string;
  dealId?: string;
}
interface Declarante {
  cnpj: string;
  nomeEmpresarial: string;
  uf: string;
  codigoMunicipio: string;
}
interface PreviewResponse {
  year: number;
  declarante: Declarante;
  dispensado: boolean;
  records: DimobRecord[];
  issues: Issue[];
  canGenerate: boolean;
}

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const cpfCnpjMask = (d: string) =>
  d.length === 14
    ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
    : d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");

export function DimobReportClient() {
  const currentYear = new Date().getFullYear();
  // Padrão: ano-calendário anterior (a DIMOB é do ano fechado).
  const [year, setYear] = useState(currentYear - 1);
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async (y: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dimob/preview?year=${y}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Falha ao carregar prévia");
      }
      setData(await res.json());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(year);
  }, [year, load]);

  async function generate() {
    setGenerating(true);
    try {
      const res = await fetch(`/api/dimob/generate?year=${year}`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Falha ao gerar o arquivo");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `DIMOB_${year}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Arquivo DIMOB gerado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao gerar");
    } finally {
      setGenerating(false);
    }
  }

  const errors = data?.issues.filter((i) => i.level === "error") ?? [];
  const warnings = data?.issues.filter((i) => i.level === "warning") ?? [];
  const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear - i);

  return (
    <div className="space-y-5">
      {/* Controles */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-2">
            <label htmlFor="dimob-year" className="text-sm text-muted-foreground">
              Ano-calendário
            </label>
            <select
              id="dimob-year"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <Button
            onClick={generate}
            disabled={generating || loading || !data?.canGenerate}
          >
            {generating ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1 h-4 w-4" />
            )}
            Gerar TXT
          </Button>
        </CardContent>
      </Card>

      {/* Dispensa */}
      {data?.dispensado && (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Nenhuma operação de venda encontrada em {year}. A DIMOB é dispensada quando
            não há operações no ano-calendário (FAQ RFB p6).
          </CardContent>
        </Card>
      )}

      {/* Declarante */}
      {data && !data.dispensado && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Declarante</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              <span className="text-muted-foreground">Razão social:</span>{" "}
              {data.declarante.nomeEmpresarial || "—"}
            </p>
            <p>
              <span className="text-muted-foreground">CNPJ:</span>{" "}
              {data.declarante.cnpj ? cpfCnpjMask(data.declarante.cnpj) : "—"} ·{" "}
              <span className="text-muted-foreground">UF:</span> {data.declarante.uf || "—"} ·{" "}
              <span className="text-muted-foreground">Município:</span>{" "}
              {data.declarante.codigoMunicipio || "—"}
            </p>
            {errors.some((e) => e.scope === "declarante") && (
              <p className="pt-1 text-xs">
                <Link href="/settings/fiscal" className="font-medium text-primary underline">
                  Completar dados fiscais do declarante →
                </Link>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Pendências */}
      {(errors.length > 0 || warnings.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Pendências ({errors.length} bloqueiam · {warnings.length} avisos)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {errors.map((i, idx) => (
              <div key={`e${idx}`} className="flex items-start gap-2">
                <Badge variant="destructive" className="shrink-0">Bloqueia</Badge>
                <span>{i.message}</span>
              </div>
            ))}
            {warnings.map((i, idx) => (
              <div key={`w${idx}`} className="flex items-start gap-2">
                <Badge variant="secondary" className="shrink-0">Aviso</Badge>
                <span className="text-muted-foreground">{i.message}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Operações */}
      {data && !data.dispensado && data.records.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Operações ({data.records.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Vendedor</th>
                  <th className="px-4 py-2">Comprador</th>
                  <th className="px-4 py-2">Imóvel</th>
                  <th className="px-4 py-2">Data</th>
                  <th className="px-4 py-2 text-right">Valor</th>
                  <th className="px-4 py-2 text-right">Comissão</th>
                </tr>
              </thead>
              <tbody>
                {data.records.map((r, idx) => (
                  <tr key={`${r.dealId}-${idx}`} className="border-b last:border-0">
                    <td className="px-4 py-2">
                      <div>{r.vendedor.nome || <em className="text-destructive">sem nome</em>}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.vendedor.cpfCnpj ? cpfCnpjMask(r.vendedor.cpfCnpj) : "—"}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div>{r.comprador.nome || <em className="text-destructive">sem nome</em>}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.comprador.cpfCnpj ? cpfCnpjMask(r.comprador.cpfCnpj) : "—"}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {r.imovel.endereco || "—"} {r.imovel.uf ? `(${r.imovel.uf})` : ""}
                      {r.needsReview && (
                        <Badge variant="secondary" className="ml-1">revisar rateio</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {r.dataOperacao.split("-").reverse().join("/")}
                    </td>
                    <td className="px-4 py-2 text-right">{brl(r.valorAlienacao)}</td>
                    <td className="px-4 py-2 text-right">{brl(r.valorComissao)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Nota provisória do leiaute */}
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        O leiaute do TXT é provisório e deve ser validado importando o arquivo no
        programa gerador oficial (PGD DIMOB) da Receita Federal antes da entrega.
      </p>
    </div>
  );
}
