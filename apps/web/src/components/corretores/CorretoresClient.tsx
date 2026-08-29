"use client";

/**
 * Tela "Corretores" — lente de cadastro sobre o mesmo registry dos
 * destinatários de split (SplitRecipient kind="commissioner"). A tela de
 * /settings/pagamentos/split-recipients continua como lente financeira
 * (wallet/PIX/split); aqui o foco é o corretor: identificação, contato,
 * preferências de notificação e status de dados pendentes.
 *
 * Orquestrador magro — fetch, estado e composição das seções. O Sheet de
 * criar/editar, o card e o diálogo de importação vivem em componentes
 * próprios neste diretório.
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Plus, Search, Upload } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/page-header";
import { cn } from "@/lib/utils";
import { CorretorCard } from "./CorretorCard";
import { CorretorFormSheet } from "./CorretorFormSheet";
import { ImportarCorretoresDialog } from "./ImportarCorretoresDialog";
import type { Corretor } from "./types";
import { summarizeCompletion } from "./completion-toast";

interface CorretoresClientProps {
  /** FEATURE.VENDAS_PAGADORIA resolvida no server (page.tsx). */
  pagadoriaEnabled: boolean;
}

export default function CorretoresClient({ pagadoriaEnabled }: CorretoresClientProps) {
  const [corretores, setCorretores] = useState<Corretor[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Corretor | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState<Corretor | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/financeiro/split-recipients?kind=commissioner", {
        credentials: "include",
      });
      if (!res.ok) {
        toast.error("Falha ao carregar corretores");
        return;
      }
      const data = await res.json();
      setCorretores(data.recipients ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return corretores;
    const qDigits = q.replace(/\D/g, "");
    return corretores.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        (qDigits.length >= 3 && (c.cpfCnpj ?? "").includes(qDigits)) ||
        (c.creci ?? "").toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q)
    );
  }, [corretores, query]);

  // Classificação NÃO muda com a lente — active/pendingFields são semântica
  // de backend. O que muda é como agrupamos/alarmamos visualmente abaixo.
  // "Inativo" é quem foi DESATIVADO aqui (`archivedAt`), não quem está sem meio
  // de repasse. Os dois moravam no mesmo `active` e o rascunho desativado caía
  // em "Pendentes", como se ainda estivesse em circulação — e é justamente ele
  // que o picker do formulário precisa deixar de oferecer.
  const inativos = filtered.filter((c) => c.archivedAt);
  const pendentes = filtered.filter(
    (c) => !c.archivedAt && !c.active && (c.pendingFields ?? []).length > 0
  );
  const ativos = filtered.filter((c) => !c.archivedAt && c.active);
  // Lente de cadastro (pagadoria off): corretor sem meio de recebimento não é
  // motivo de alarme — entra junto dos "ativos" em vez de uma seção separada.
  const cadastroList = pagadoriaEnabled ? ativos : [...ativos, ...pendentes];

  function openCreate() {
    setEditing(null);
    setSheetOpen(true);
  }

  function openEdit(c: Corretor) {
    setEditing(c);
    setSheetOpen(true);
  }

  async function patchNotify(c: Corretor, patch: Partial<Corretor>) {
    const res = await fetch(`/api/financeiro/split-recipients/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Falha ao atualizar notificações");
      return;
    }
    setCorretores((prev) => prev.map((r) => (r.id === c.id ? { ...r, ...patch } : r)));
  }

  async function deactivate(c: Corretor) {
    // PATCH em vez de DELETE: além de tirar de novas cobranças (active:false,
    // o que o DELETE já fazia), liga notifyOptOut — sem isso o resolvedor de
    // notificações (deal-brokers.isEligible) continuaria notificando rascunhos
    // "desativados" e o texto do diálogo mentiria.
    const res = await fetch(`/api/financeiro/split-recipients/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ active: false, notifyOptOut: true }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Falha ao desativar");
      return;
    }
    toast.success("Corretor desativado");
    setConfirmDeactivate(null);
    void load();
  }

  async function reactivate(c: Corretor) {
    const res = await fetch(`/api/financeiro/split-recipients/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      // Reativar restaura também as notificações (simétrico ao desativar).
      body: JSON.stringify({ active: true, notifyOptOut: false }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Falha ao reativar");
      return;
    }
    toast.success("Corretor reativado");
    void load();
  }

  async function requestCompletion(c: Corretor) {
    // Sem body: usa os canais default (viáveis) do servidor.
    const res = await fetch(`/api/financeiro/split-recipients/${c.id}/request-completion`, {
      method: "POST",
      credentials: "include",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Falha ao gerar link");
      return;
    }
    const { message, anySent } = summarizeCompletion(data);
    if (anySent) toast.success(message);
    else toast.error(message);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Corretores"
        description="Cadastro único de corretores parceiros: dados de contato, recebimento de comissão e preferências de notificação das atualizações do processo. Sem duplicidade — o CPF/CNPJ identifica o corretor."
      >
        <Button variant="outline" onClick={() => setImportOpen(true)}>
          <Upload className="h-4 w-4 mr-1" /> Importar dos contratos
        </Button>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" /> Novo corretor
        </Button>
      </PageHeader>

      <div className="relative max-w-sm">
        <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome, CPF/CNPJ, CRECI ou email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8"
        />
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {corretores.length === 0 ? (
              <>
                Nenhum corretor cadastrado ainda. Corretores informados nos
                formulários de venda entram aqui automaticamente, ou clique em{" "}
                <b>Novo corretor</b>.
              </>
            ) : (
              "Nenhum corretor encontrado pra esta busca."
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {pagadoriaEnabled && pendentes.length > 0 && (
            <Section title={`Dados de pagamento pendentes (${pendentes.length})`} tone="amber">
              {pendentes.map((c) => (
                <CorretorCard
                  key={c.id}
                  c={c}
                  pagadoriaEnabled={pagadoriaEnabled}
                  onEdit={() => openEdit(c)}
                  onDeactivate={() => setConfirmDeactivate(c)}
                  onRequestCompletion={() => requestCompletion(c)}
                  onNotifyPatch={(patch) => patchNotify(c, patch)}
                />
              ))}
            </Section>
          )}
          {cadastroList.length > 0 && (
            <Section
              title={
                pagadoriaEnabled
                  ? `Ativos (${cadastroList.length})`
                  : `Corretores (${cadastroList.length})`
              }
            >
              {cadastroList.map((c) => (
                <CorretorCard
                  key={c.id}
                  c={c}
                  pagadoriaEnabled={pagadoriaEnabled}
                  onEdit={() => openEdit(c)}
                  onDeactivate={() => setConfirmDeactivate(c)}
                  onRequestCompletion={() => requestCompletion(c)}
                  onNotifyPatch={(patch) => patchNotify(c, patch)}
                />
              ))}
            </Section>
          )}
          {inativos.length > 0 && (
            <Section title={`Inativos (${inativos.length})`}>
              {inativos.map((c) => (
                <CorretorCard
                  key={c.id}
                  c={c}
                  pagadoriaEnabled={pagadoriaEnabled}
                  inactive
                  onEdit={() => openEdit(c)}
                  onReactivate={() => reactivate(c)}
                  onNotifyPatch={(patch) => patchNotify(c, patch)}
                />
              ))}
            </Section>
          )}
        </>
      )}

      <CorretorFormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        editing={editing}
        pagadoriaEnabled={pagadoriaEnabled}
        onSaved={load}
      />

      <ImportarCorretoresDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={load}
      />

      <AlertDialog
        open={confirmDeactivate !== null}
        onOpenChange={(o) => !o && setConfirmDeactivate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Desativar &ldquo;{confirmDeactivate?.label}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              O corretor deixa de receber notificações e não pode ser usado em
              novas cobranças. O histórico permanece e você pode reativar a
              qualquer momento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => confirmDeactivate && deactivate(confirmDeactivate)}
            >
              Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "amber";
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div
        className={cn(
          "flex items-center gap-1 text-xs font-medium uppercase",
          tone === "amber" ? "text-warning" : "text-muted-foreground"
        )}
      >
        {tone === "amber" && <AlertTriangle className="h-3.5 w-3.5" />}
        {title}
      </div>
      {children}
    </div>
  );
}
