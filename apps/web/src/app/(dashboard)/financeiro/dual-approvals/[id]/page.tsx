"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ElevationDialog } from "@/components/security/ElevationDialog";
import { useElevation } from "@/hooks/useElevation";
import { ArrowLeft, CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";

function fmtBRL(v: number | null) {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function DualApprovalDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const elevation = useElevation();
  const [approval, setApproval] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [rejectNote, setRejectNote] = useState("");
  const [approveNote, setApproveNote] = useState("");
  const [elevOpen, setElevOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/financeiro/dual-approvals/${id}`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setApproval(data.approval);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function approve() {
    if (!elevation.hasScope("TRANSFER")) {
      setElevOpen(true);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/financeiro/dual-approvals/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ note: approveNote || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Falha ao aprovar");
        return;
      }
      toast.success("Aprovação registrada — o iniciador pode executar a operação");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (rejectNote.length < 3) {
      toast.error("Nota obrigatória (mínimo 3 chars)");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/financeiro/dual-approvals/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ note: rejectNote }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Falha");
        return;
      }
      toast.success("Operação rejeitada");
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (!approval)
    return <p className="text-sm text-muted-foreground">Não encontrada</p>;

  return (
    <div className="max-w-2xl space-y-4">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/financeiro/dual-approvals">
          <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Aprovação dupla — {approval.kind}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline">{approval.status}</Badge>
            <span className="text-2xl font-bold">{fmtBRL(approval.amount)}</span>
          </div>

          <div className="space-y-1 text-sm">
            <div>
              <span className="text-muted-foreground">Iniciada por:</span>{" "}
              {approval.initiator.name ?? approval.initiator.email}
            </div>
            <div>
              <span className="text-muted-foreground">Criada em:</span>{" "}
              {new Date(approval.createdAt).toLocaleString("pt-BR")}
            </div>
            <div>
              <span className="text-muted-foreground">Expira em:</span>{" "}
              {new Date(approval.expiresAt).toLocaleString("pt-BR")}
            </div>
            {approval.approver && (
              <div>
                <span className="text-muted-foreground">Aprovada por:</span>{" "}
                {approval.approver.name ?? approval.approver.email}
              </div>
            )}
            {approval.reason && (
              <div>
                <span className="text-muted-foreground">Motivo:</span> {approval.reason}
              </div>
            )}
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              Ver payload completo
            </summary>
            <pre className="mt-2 p-2 bg-muted rounded overflow-x-auto">
              {JSON.stringify(approval.payload, null, 2)}
            </pre>
          </details>
        </CardContent>
      </Card>

      {approval.canApprove && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <AlertTriangle className="h-5 w-5 inline mr-1 text-amber-500" />
              Aprovar ou rejeitar
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Analise o payload acima antes de decidir. Esta ação será registrada no
              audit log e notificará o iniciador por email.
            </p>

            <div>
              <label className="text-sm font-medium">
                Observação ao aprovar (opcional)
              </label>
              <Textarea
                value={approveNote}
                onChange={(e) => setApproveNote(e.target.value)}
                placeholder="Ex: Aprovado — operação legítima conferida com o solicitante"
                maxLength={500}
              />
              <Button
                onClick={approve}
                disabled={busy}
                className="mt-2 bg-green-600 hover:bg-green-700"
              >
                <CheckCircle2 className="h-4 w-4 mr-1" /> Aprovar
              </Button>
            </div>

            <hr />

            <div>
              <label className="text-sm font-medium text-red-600">
                Observação ao rejeitar (obrigatória)
              </label>
              <Textarea
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="Ex: Valor incompatível com o escopo aprovado"
                maxLength={500}
              />
              <Button
                variant="destructive"
                onClick={reject}
                disabled={busy || rejectNote.length < 3}
                className="mt-2"
              >
                <XCircle className="h-4 w-4 mr-1" /> Rejeitar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {approval.status === "PENDING" && !approval.canApprove && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="pt-6 text-sm text-amber-900">
            Você não pode aprovar esta solicitação (só pode ser aprovada por um admin
            diferente do iniciador).
          </CardContent>
        </Card>
      )}

      <ElevationDialog
        open={elevOpen}
        onOpenChange={setElevOpen}
        scopes={["TRANSFER"]}
        onSuccess={approve}
      />
    </div>
  );
}
