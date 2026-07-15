"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { proposalStatusView } from "@/lib/proposals/status-view";

interface Proposal {
  id: string;
  title: string;
  status: string;
  kind: string;
  validUntil: string | null;
  createdAt: string;
  dossierUrl: string | null;
  resumo: { proponente: string | null; imovel: string | null; valor: number | null };
}

function money(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function ProposalDetailClient({
  proposal,
  signers,
  events,
  attachments,
}: {
  proposal: Proposal;
  signers: { id: string; name: string; role: string; channel: string; status: string }[];
  events: { id: string; eventName: string; receivedAt: string }[];
  attachments: { id: string; filename: string; category: string | null; url: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const sv = proposalStatusView(proposal.status);

  const canConvert = ["completa", "assinada_proponente", "aguardando_vendedor"].includes(
    proposal.status
  );
  const canConvertUnsigned = ["enviada", "entregue", "visualizada", "rascunho"].includes(
    proposal.status
  );

  async function convert(allowUnsigned: boolean) {
    if (allowUnsigned) {
      const reason = window.prompt(
        "Converter sem assinatura. Qual o motivo? (fica no histórico)"
      );
      if (!reason?.trim()) return;
      await doConvert({ allowUnsigned: true, unsignedReason: reason });
    } else {
      await doConvert({});
    }
  }

  async function doConvert(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/proposals/${proposal.id}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      toast.success("Proposta convertida em negócio");
      if (d.dealId) router.push(`/deals/${d.dealId}`);
      else router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao converter");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link
            href="/pipeline/propostas"
            className="text-sm text-muted-foreground hover:underline inline-flex items-center"
          >
            <ChevronLeft className="h-4 w-4" /> Propostas
          </Link>
          <h1 className="text-xl font-semibold mt-1">{proposal.title}</h1>
          <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
            <Badge variant="outline" className={sv.className}>
              {sv.label}
            </Badge>
            <span>· {proposal.kind === "venda" ? "Venda" : "Locação"}</span>
            <span>· criada {fmt(proposal.createdAt)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {canConvert && (
            <Button onClick={() => convert(false)} disabled={busy}>
              Converter em negócio
            </Button>
          )}
          {!canConvert && canConvertUnsigned && (
            <Button variant="outline" onClick={() => convert(true)} disabled={busy}>
              Converter sem assinatura
            </Button>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-4 space-y-2">
          <h2 className="font-medium">Resumo</h2>
          <Row label="Proponente" value={proposal.resumo.proponente ?? "—"} />
          <Row label="Imóvel" value={proposal.resumo.imovel ?? "—"} />
          <Row label="Valor" value={money(proposal.resumo.valor)} />
          <Row
            label="Validade"
            value={proposal.validUntil ? fmt(proposal.validUntil) : "—"}
          />
          {proposal.dossierUrl && (
            <a
              href={proposal.dossierUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-2"
            >
              <FileText className="h-4 w-4" /> Documento final (PDF)
            </a>
          )}
        </Card>

        <Card className="p-4 space-y-2">
          <h2 className="font-medium">Assinaturas</h2>
          {signers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum signatário definido ainda.</p>
          ) : (
            <ul className="text-sm space-y-1">
              {signers.map((s) => (
                <li key={s.id} className="flex justify-between">
                  <span>
                    {s.name} <span className="text-muted-foreground">· {s.role}</span>
                  </span>
                  <span className="text-muted-foreground">{s.channel}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {attachments.length > 0 && (
        <Card className="p-4 space-y-2">
          <h2 className="font-medium">Documentos</h2>
          <ul className="text-sm space-y-1">
            {attachments.map((a) => (
              <li key={a.id}>
                <a href={a.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                  {a.filename}
                </a>
                {a.category && <span className="text-muted-foreground"> · {a.category}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-4 space-y-1">
        <h2 className="font-medium">Histórico</h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem eventos ainda.</p>
        ) : (
          <ul className="text-sm space-y-1">
            {events.map((e) => (
              <li key={e.id} className="flex justify-between">
                <span>{e.eventName}</span>
                <span className="text-muted-foreground">{fmt(e.receivedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
