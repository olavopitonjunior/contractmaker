"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  FileText,
  Camera,
  Upload,
  RefreshCw,
  ShieldCheck,
  Info,
} from "lucide-react";
import { getKycInstruction } from "@/lib/asaas/kyc-instructions";

interface DocSlot {
  asaasDocumentId: string;
  type: string;
  title: string;
  description: string | null;
  status: string;
  fileName?: string | null;
}

interface KycState {
  accountId: string;
  name: string;
  personType: "PHYSICAL" | "LEGAL";
  status: string;
  documentationStatus: string | null;
  generalStatus: string | null;
  approvedAt: string | null;
  docs: DocSlot[];
}

export function KycPublicClient({ token }: { token: string }) {
  const [state, setState] = useState<KycState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    const res = await fetch(`/api/public/kyc/${token}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Falha ao carregar");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setState(data);
    setLoading(false);
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await load();
      toast.success("Status atualizado");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Carregando…
        </CardContent>
      </Card>
    );
  }
  if (!state) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Não foi possível carregar. Confirme o link com quem enviou.
        </CardContent>
      </Card>
    );
  }

  if (state.status === "APPROVED") {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-3">
          <CheckCircle2 className="h-12 w-12 mx-auto text-green-600" />
          <h1 className="text-xl font-semibold">Conta aprovada ✓</h1>
          <p className="text-sm text-muted-foreground">
            Sua subconta {state.name} está aprovada
            {state.approvedAt
              ? ` desde ${new Date(state.approvedAt).toLocaleDateString("pt-BR")}`
              : ""}
            . Você não precisa enviar mais documentos.
          </p>
        </CardContent>
      </Card>
    );
  }

  const sent = state.docs.filter(
    (d) => d.status === "PENDING" || d.status === "APPROVED"
  ).length;
  const total = state.docs.length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Envio de documentos — {state.name}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Esta é a página oficial para o titular enviar os documentos do
            KYC. Os arquivos são enviados diretamente para o Asaas — não
            ficam armazenados no Contractmaker.
          </p>
          <div className="border rounded p-3 bg-blue-50 border-blue-200 text-xs text-blue-900 space-y-1">
            <div className="flex items-start gap-1.5">
              <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">Como funciona</p>
                <ol className="list-decimal ml-4 mt-1 space-y-0.5">
                  <li>Envie cada documento solicitado abaixo</li>
                  <li>O Asaas valida automaticamente (OCR + biometria)</li>
                  <li>
                    Após enviar todos, o status muda para &quot;Em
                    análise&quot; — geralmente aprovado em até 1 dia útil
                  </li>
                </ol>
              </div>
            </div>
          </div>
          <div className="text-sm">
            Progresso: <strong>{sent}</strong> de {total} enviados
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3">
        {state.docs.map((d) => (
          <DocCard key={d.asaasDocumentId} token={token} doc={d} onUploaded={load} />
        ))}
      </div>

      {total === 0 && (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Nenhum documento pendente no momento. Atualize em alguns instantes
            ou peça orientação a quem te enviou este link.
          </CardContent>
        </Card>
      )}

      <div className="flex justify-center">
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={refreshing}
          className="gap-1.5"
        >
          <RefreshCw
            className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
          />
          Atualizar status
        </Button>
      </div>

      <p className="text-xs text-muted-foreground text-center pt-4">
        Plataforma Contractmaker · Subconta pagadoria Asaas
      </p>
    </div>
  );
}

function DocCard({
  token,
  doc,
  onUploaded,
}: {
  token: string;
  doc: DocSlot;
  onUploaded: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const instruction = getKycInstruction(doc.type);
  const Icon = doc.type.toUpperCase() === "SELFIE" ? Camera : FileText;
  const status = doc.status.toUpperCase();

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(
        `/api/public/kyc/${token}/upload/${doc.asaasDocumentId}`,
        { method: "POST", body: form }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Falha no upload");
        return;
      }
      toast.success(`${doc.title} enviado`);
      onUploaded();
    } finally {
      setUploading(false);
    }
  }

  const bg =
    status === "APPROVED"
      ? "bg-green-50 border-green-300"
      : status === "REJECTED"
        ? "bg-red-50 border-red-300"
        : status === "PENDING"
          ? "bg-blue-50 border-blue-300"
          : "bg-white";

  return (
    <Card className={`border ${bg}`}>
      <CardContent className="pt-4 pb-3 space-y-2">
        <div className="flex items-start gap-2">
          <Icon className="h-5 w-5 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm">
              {instruction?.title ?? doc.title}
            </div>
            {instruction && (
              <div className="text-xs text-muted-foreground mt-1 space-y-1">
                <p>{instruction.what}</p>
                {instruction.tips.length > 0 && (
                  <ul className="list-disc ml-4 space-y-0.5">
                    {instruction.tips.map((tip, i) => (
                      <li key={i}>{tip}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {!instruction && doc.description && (
              <p className="text-xs text-muted-foreground mt-1">
                {doc.description}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <Badge
            variant="outline"
            className={
              status === "APPROVED"
                ? "bg-green-100 text-green-900 border-green-300"
                : status === "REJECTED"
                  ? "bg-red-100 text-red-900 border-red-300"
                  : status === "PENDING"
                    ? "bg-blue-100 text-blue-900 border-blue-300"
                    : ""
            }
          >
            {status === "APPROVED"
              ? "Aprovado"
              : status === "REJECTED"
                ? "Rejeitado"
                : status === "PENDING"
                  ? "Em análise"
                  : "Não enviado"}
          </Badge>

          {(status === "NOT_SENT" || status === "REJECTED") && (
            <label className="cursor-pointer">
              <input
                type="file"
                className="hidden"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={handleUpload}
                disabled={uploading}
              />
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded font-medium ${
                  uploading
                    ? "bg-muted text-muted-foreground"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                }`}
              >
                <Upload className="h-3.5 w-3.5" />
                {uploading ? "Enviando…" : "Enviar"}
              </span>
            </label>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
