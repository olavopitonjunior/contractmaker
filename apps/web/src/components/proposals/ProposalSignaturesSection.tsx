"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileSignature, RefreshCw, Loader2 } from "lucide-react";
import { EnvelopeCard } from "@/components/signatures/EnvelopeCard";
import type { EnvelopeRow } from "@/hooks/useEnvelopePolling";

/** "completa" = via do proponente (1ª); "reduzida" = via do proprietário (2ª). */
const VIA_LABEL: Record<string, string> = {
  completa: "1ª via — proponente",
  reduzida: "2ª via — proprietário",
};

/**
 * Gestão de assinaturas DENTRO da proposta, equivalente à aba Assinaturas do
 * contrato.
 *
 * Os envelopes de proposta sempre existiram no banco (`Envelope.proposalId`,
 * `source="proposal"`), mas o detalhe só mostrava uma lista de signatários: sem
 * status do envelope, custo, prazo, erro, PDF assinado, cancelamento ou sync.
 * Aqui reusamos o `<EnvelopeCard />` inteiro — ele é genérico sobre `basePath`,
 * e `/api/proposals/[id]/envelopes/*` implementa o mesmo contrato de rotas.
 *
 * Só aparece no instrumento "envelope". O Aceite via WhatsApp NÃO cria envelope
 * nenhum (é um termo de aceite, não assinatura em documento), então lá quem
 * manda continua sendo a lista de signatários do card ao lado.
 */
export function ProposalSignaturesSection({
  proposalId,
  canSync,
  /**
   * Muda a cada avanço do polling da proposta (`useProposalPolling`) — refaz o
   * fetch dos envelopes. Sem isso a seção congelaria no primeiro carregamento e
   * mostraria "Aguardando" depois de o webhook já ter registrado a assinatura.
   */
  refreshKey = "",
}: {
  proposalId: string;
  canSync: boolean;
  refreshKey?: string;
}) {
  const [envelopes, setEnvelopes] = useState<EnvelopeRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/proposals/${proposalId}/envelopes`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setEnvelopes(Array.isArray(d.envelopes) ? d.envelopes : []);
      setFailed(false);
    } catch {
      // Sem toast (o polling refaz o fetch e viraria ruído), mas a falha PRECISA
      // aparecer: o servidor só renderiza esta seção quando existe envelope, e
      // ela substitui a lista simples de signatários. Sumir em silêncio deixaria
      // a proposta sem nenhuma informação de assinatura na tela.
      setFailed(true);
    }
  }, [proposalId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function sync() {
    setSyncing(true);
    try {
      const res = await fetch(`/api/proposals/${proposalId}/sync`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      toast.success("Sincronizado com a ClickSign.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível sincronizar.");
    } finally {
      setSyncing(false);
    }
  }

  // Falha de rede/permissão: mostra o motivo e o caminho de volta, em vez de
  // deixar a tela sem seção nenhuma.
  if (failed) {
    return (
      <Card className="space-y-2 p-4">
        <div className="flex items-center gap-2">
          <FileSignature className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-medium">Assinaturas</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Não foi possível carregar os envelopes de assinatura.
        </p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Tentar de novo
        </Button>
      </Card>
    );
  }

  // Sem envelope não há o que gerenciar (rascunho, ou instrumento Aceite).
  if (!envelopes || envelopes.length === 0) return null;

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileSignature className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-medium">Assinaturas</h2>
        </div>
        {canSync && (
          <Button variant="outline" size="sm" onClick={sync} disabled={syncing}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {envelopes.map((env) => (
          <div key={env.id} className="space-y-1">
            {env.via && (
              <div className="text-xs font-medium text-muted-foreground">
                {VIA_LABEL[env.via] ?? env.via}
              </div>
            )}
            <EnvelopeCard
              envelope={env}
              basePath={`/api/proposals/${proposalId}/envelopes/${env.id}`}
              onChange={load}
            />
          </div>
        ))}
      </div>

      {syncing && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Consultando a ClickSign…
        </p>
      )}
    </Card>
  );
}
