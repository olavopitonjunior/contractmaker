"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, CheckCircle2, XCircle, Clock } from "lucide-react";

interface Approval {
  id: string;
  kind: string;
  status: string;
  amount: number | null;
  reason: string | null;
  initiator: { id: string; name: string | null; email: string };
  approver: { id: string; name: string | null; email: string } | null;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  executedAt: string | null;
}

function fmtBRL(v: number | null) {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR");
}

const KIND_LABEL: Record<string, string> = {
  TRANSFER: "Transferência",
  REFUND_LARGE: "Estorno alto valor",
  SPLIT_CHANGE: "Alteração de split",
  FEES_CHANGE: "Alteração de taxas",
};

const STATUS_UI: Record<string, { color: string; icon: any; text: string }> = {
  PENDING: { color: "bg-amber-100 text-amber-900", icon: Clock, text: "Aguardando" },
  APPROVED: { color: "bg-green-100 text-green-900", icon: CheckCircle2, text: "Aprovada" },
  REJECTED: { color: "bg-red-100 text-red-900", icon: XCircle, text: "Rejeitada" },
  EXPIRED: { color: "bg-gray-100 text-gray-700", icon: AlertTriangle, text: "Expirada" },
  CANCELLED: { color: "bg-gray-100 text-gray-700", icon: XCircle, text: "Cancelada" },
};

export default function DualApprovalsPage() {
  const [status, setStatus] = useState("PENDING");
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/financeiro/dual-approvals?status=${status}`,
          { credentials: "include" }
        );
        if (res.ok) {
          const data = await res.json();
          setApprovals(data.approvals);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [status]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Aprovações duplas</h1>
          <p className="text-sm text-muted-foreground">
            Operações de alto valor que exigem aprovação de um segundo admin.
          </p>
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PENDING">Aguardando</SelectItem>
            <SelectItem value="APPROVED">Aprovadas</SelectItem>
            <SelectItem value="REJECTED">Rejeitadas</SelectItem>
            <SelectItem value="EXPIRED">Expiradas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : approvals.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma aprovação {STATUS_UI[status]?.text.toLowerCase()}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {approvals.map((a) => {
            const ui = STATUS_UI[a.status] ?? STATUS_UI.PENDING;
            const Icon = ui.icon;
            return (
              <Link key={a.id} href={`/financeiro/dual-approvals/${a.id}`}>
                <Card className="hover:bg-muted/50 transition cursor-pointer">
                  <CardContent className="pt-4 flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className={ui.color}>
                          <Icon className="h-3 w-3 mr-1" /> {ui.text}
                        </Badge>
                        <span className="text-sm font-medium">
                          {KIND_LABEL[a.kind] ?? a.kind}
                        </span>
                        <span className="text-lg font-bold">{fmtBRL(a.amount)}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Iniciado por {a.initiator.name ?? a.initiator.email} em{" "}
                        {fmtDateTime(a.createdAt)}
                      </div>
                      {a.reason && (
                        <div className="text-xs text-muted-foreground mt-1">
                          &ldquo;{a.reason}&rdquo;
                        </div>
                      )}
                    </div>
                    {a.status === "PENDING" && (
                      <div className="text-xs text-amber-700">
                        Expira {fmtDateTime(a.expiresAt)}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
