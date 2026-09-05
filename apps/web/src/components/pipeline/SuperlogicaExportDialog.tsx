"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertTriangle, Building2, ExternalLink, Loader2 } from "lucide-react";
import { formatMoneyBR } from "@/lib/format/money";

interface Warning {
  code: string;
  message: string;
  blocking: boolean;
}

interface Preview {
  canExport: boolean;
  stageName: string;
  stageAllowed: boolean;
  exportableStages: string[];
  warnings: Warning[];
  existing: { status: string; vendaId: string | null; url: string | null; lastError: string | null } | null;
  resumo: {
    imovel: string | null;
    tipoImovel: number;
    vendedores: Array<{ nome: string; documento: string | null }>;
    compradores: Array<{ nome: string; documento: string | null }>;
    comissionados: Array<{ nome: string; papel: string; valor: number; participacao: number }>;
    valorVenda: number;
    comissaoTotal: number;
    comissaoPercentual: number;
    quemPaga: string;
    contaBancariaId: number | null;
    dataVenda: string | null;
    prazoDias: number;
  };
}

export interface SuperlogicaExportResult {
  vendaId: string;
  url: string;
  alreadyExported: boolean;
  movedToStage: string | null;
}

const PAPEL_LABEL: Record<string, string> = {
  captador: "Captador",
  intermediador: "Corretor vendedor",
  indicador: "Indicação",
  imobiliaria_principal: "Imobiliária",
  outro: "Parceria",
};

const QUEM_PAGA_LABEL: Record<string, string> = {
  vendedor: "vendedor (proprietário)",
  comprador: "comprador",
  ambos: "ambas as partes",
  outro: "padrão da organização",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "hoje (sem data de assinatura registrada)";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "hoje"
    : d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/**
 * Preview + confirmação da exportação de uma venda para a Superlógica.
 * O preview não escreve nada lá; só o botão "Enviar" cria pessoas, imóvel e
 * venda. O que aparece aqui é o espelho da tela "Venda" da Superlógica.
 */
export function SuperlogicaExportDialog({
  dealId,
  open,
  onOpenChange,
  onExported,
}: {
  dealId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExported: (r: SuperlogicaExportResult) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPreview(null);
    fetch(`/api/deals/${dealId}/superlogica/preview`, { method: "POST" })
      .then(async (res) => {
        const d = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(d.error ?? "Não foi possível montar o preview.");
          return;
        }
        setPreview(d as Preview);
      })
      .catch(() => {
        if (!cancelled) setError("Não foi possível montar o preview.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, dealId]);

  async function send() {
    setSending(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/superlogica/export`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        const extra = Array.isArray(d.warnings)
          ? ` ${(d.warnings as Warning[]).map((w) => w.message).join(" ")}`
          : "";
        throw new Error((d.error ?? "Falha ao exportar") + extra);
      }
      toast.success(
        d.alreadyExported
          ? `Esta venda já estava na Superlógica (venda ${d.vendaId}).`
          : `Venda ${d.vendaId} criada na Superlógica.`
      );
      onExported(d as SuperlogicaExportResult);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao exportar");
    } finally {
      setSending(false);
    }
  }

  const blocking = preview?.warnings.filter((w) => w.blocking) ?? [];
  const info = preview?.warnings.filter((w) => !w.blocking) ?? [];
  const r = preview?.resumo;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" /> Enviar venda para a Superlógica
          </DialogTitle>
          <DialogDescription>
            Confira o que vai ser criado na Superlógica. Nada é gravado lá até você clicar em Enviar.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Montando o preview…
          </div>
        )}
        {error && (
          <p className="flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </p>
        )}

        {preview && r && (
          <div className="space-y-4 text-sm">
            {preview.existing?.status === "done" && preview.existing.url && (
              <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-emerald-900">
                Esta venda já está na Superlógica como{" "}
                <a href={preview.existing.url} target="_blank" rel="noreferrer" className="underline">
                  venda {preview.existing.vendaId}
                </a>
                .
              </div>
            )}
            {preview.existing?.status === "error" && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
                A última tentativa falhou: {preview.existing.lastError}. Ao enviar de novo, o que já
                foi criado é reaproveitado.
              </div>
            )}
            {preview.existing?.status === "running" && (
              <div className="rounded-md border border-sky-300 bg-sky-50 p-3 text-sky-900">
                Há uma exportação em andamento para este negócio (outra aba ou outro usuário). Aguarde
                e reabra este preview.
              </div>
            )}
            {!preview.stageAllowed && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
                O negócio está em &quot;{preview.stageName}&quot;. A venda só é enviada a partir de
                &quot;{preview.exportableStages[0]}&quot;.
              </div>
            )}

            <section className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase text-muted-foreground">Venda</p>
                <p>Vendido em {fmtDate(r.dataVenda)}</p>
                <p>Valor {formatMoneyBR(r.valorVenda)}</p>
                <p>
                  Comissão {formatMoneyBR(r.comissaoTotal)} ({r.comissaoPercentual}%) em 1 parcela,
                  vencendo {r.prazoDias} dias após a venda, cobrada do{" "}
                  {QUEM_PAGA_LABEL[r.quemPaga] ?? r.quemPaga}
                </p>
                <p className="text-muted-foreground">
                  Conta bancária das parcelas: {r.contaBancariaId ?? "não definida"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-muted-foreground">Imóvel</p>
                <p>{r.imovel ?? "—"}</p>
                <p className="text-muted-foreground">Tipo padrão da organização: {r.tipoImovel}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-muted-foreground">Proprietários (vendedores)</p>
                <ul className="list-disc pl-4">
                  {r.vendedores.map((p, i) => (
                    <li key={i}>
                      {p.nome} {p.documento && <span className="text-muted-foreground">{p.documento}</span>}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-muted-foreground">Compradores</p>
                <ul className="list-disc pl-4">
                  {r.compradores.map((p, i) => (
                    <li key={i}>
                      {p.nome} {p.documento && <span className="text-muted-foreground">{p.documento}</span>}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs font-medium uppercase text-muted-foreground">Comissionados</p>
                <ul className="list-disc pl-4">
                  {r.comissionados.map((c, i) => (
                    <li key={i}>
                      {c.nome} — {PAPEL_LABEL[c.papel] ?? c.papel} — {formatMoneyBR(c.valor)} ({c.participacao}%)
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            {blocking.length > 0 && (
              <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <p className="font-medium text-destructive">Bloqueios</p>
                <ul className="list-disc pl-4 text-destructive">
                  {blocking.map((w, i) => (
                    <li key={i}>{w.message}</li>
                  ))}
                </ul>
              </div>
            )}
            {info.length > 0 && (
              <div className="space-y-1 rounded-md border p-3">
                <p className="font-medium">Avisos</p>
                <ul className="list-disc pl-4 text-muted-foreground">
                  {info.map((w, i) => (
                    <li key={i}>{w.message}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {preview?.existing?.url && (
            <Button variant="outline" asChild>
              <a href={preview.existing.url} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1 h-4 w-4" /> Abrir na Superlógica
              </a>
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={sending}>
            Fechar
          </Button>
          <Button onClick={send} disabled={!preview?.canExport || sending || loading}>
            {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Enviar para a Superlógica
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Badge compacto para o header/aba do negócio. */
export function SuperlogicaExportBadge({ vendaId, url }: { vendaId: string; url: string }) {
  return (
    <Badge variant="secondary" asChild>
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1">
        <Building2 className="h-3 w-3" /> Na Superlógica: venda {vendaId}
      </a>
    </Badge>
  );
}
