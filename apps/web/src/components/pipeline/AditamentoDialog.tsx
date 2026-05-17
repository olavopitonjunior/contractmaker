"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Sparkles, FileText, Edit3, MessageSquare, X } from "lucide-react";
import { toast } from "sonner";

/**
 * F4 iteração 2026-05-17 — Dialog unificado pra tratar findings de certidões.
 *
 * Substitui a navegação direta do CertidoesAnalysisPanel pra:
 *   - signed → permite criar aditamento (Contract kind="addendum")
 *   - draft  → permite aplicar diretamente no contrato original
 *   - sempre → permite apenas comentar (sem write)
 *
 * Selector tem 2 opções dinâmicas (não 3) baseadas em signingState.
 * Campo texto livre é OPCIONAL — usuário descreve refinamento, IA usa o
 * `suggested_aditamento` do finding como base.
 *
 * Em findings com `clarification_paths`, mostra a lista em vez do CTA de
 * aditamento — o usuário precisa coletar info antes.
 */

interface Finding {
  kind: string;
  severity: "error" | "warning" | "info";
  message: string;
  target?: string;
  endpoint?: string;
  suggested_aditamento?: string;
  clarification_paths?: string[];
  manual_action?: { label: string; url?: string };
  jobId?: string;
}

interface SigningState {
  hasSignedContract: boolean;
  signedAt: string | null;
  originalContractId: string | null;
}

type Action = "draft_edit" | "create_addendum" | "comment_only";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  contractId: string;
  signingState: SigningState | null;
  finding: Finding;
}

export function AditamentoDialog({
  open,
  onOpenChange,
  dealId,
  contractId,
  signingState,
  finding,
}: Props) {
  const isSigned = !!signingState?.hasSignedContract;
  const hasSuggestion = !!finding.suggested_aditamento;
  const hasClarification = !!finding.clarification_paths?.length;

  // Default: a opção mais segura disponível.
  const defaultAction: Action = isSigned ? "create_addendum" : "draft_edit";

  const [action, setAction] = useState<Action>(defaultAction);
  const [userDescription, setUserDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setAction(defaultAction);
      setUserDescription("");
    }
  }, [open, defaultAction]);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      if (action === "comment_only") {
        // Apenas registra um comentário — endpoint leve sem agente
        await fetch(`/api/contracts/${contractId}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `[Finding: ${finding.kind}] ${finding.message}\n\nNota do usuário: ${userDescription || "(sem descrição)"}`,
            severity: finding.severity,
            selectedText: finding.target ?? finding.kind,
          }),
        });
        toast.success("Comentário registrado.");
        onOpenChange(false);
        return;
      }

      // Tanto draft_edit quanto create_addendum vão pro chat com prompt sintético.
      // No futuro, create_addendum direto pode usar /api/deals/[id]/addendum
      // pra criar sem agente (quando user já preencheu tudo).
      const prompt = buildAgentPrompt(action, finding, userDescription);
      const url = `/contracts/${contractId}?openChat=true&msg=${encodeURIComponent(prompt)}`;
      toast.info(
        action === "create_addendum"
          ? "Abrindo chat — IA vai criar o aditamento."
          : "Abrindo chat — IA vai propor as alterações no contrato."
      );
      window.location.href = url;
    } catch (err) {
      console.error("[AditamentoDialog] submit falhou:", err);
      toast.error("Falha ao processar. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  };

  const severityColor = useMemo(() => {
    switch (finding.severity) {
      case "error":
        return "text-red-700 bg-red-50 border-red-200";
      case "warning":
        return "text-amber-700 bg-amber-50 border-amber-200";
      default:
        return "text-blue-700 bg-blue-50 border-blue-200";
    }
  }, [finding.severity]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-600" />
            Tratar achado: <span className="font-mono text-sm">{finding.kind}</span>
          </DialogTitle>
        </DialogHeader>

        {/* Resumo do finding */}
        <div className={`rounded-lg border p-3 text-sm ${severityColor}`}>
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-medium mb-1 uppercase text-xs">
                [{finding.severity}] {finding.target ?? "—"}
              </div>
              <div>{finding.message}</div>
            </div>
          </div>
        </div>

        {/* Caso 1: finding ambíguo — mostra clarification_paths */}
        {hasClarification && !hasSuggestion && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
            <div className="font-medium text-amber-900 mb-2">
              ⚠️ Achado ambíguo — clarifique antes de aditar
            </div>
            <p className="text-amber-800 text-xs mb-2">
              A IA não vai propor cláusula sem mais informações — o caminho jurídico
              depende dos detalhes abaixo. Após coletar essas informações, retorne pra
              propor o aditamento específico.
            </p>
            <ol className="list-decimal pl-5 space-y-1 text-sm text-amber-900">
              {finding.clarification_paths!.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ol>
          </div>
        )}

        {/* Caso 2: finding actionable — preview do aditamento + selector */}
        {hasSuggestion && (
          <>
            <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm">
              <div className="font-medium text-violet-900 mb-2 flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                Texto-base auditado (citando base legal)
              </div>
              <div className="text-violet-900 text-xs whitespace-pre-wrap line-clamp-6">
                {finding.suggested_aditamento}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium block mb-2">Como tratar?</label>
              <div className="space-y-2">
                {isSigned ? (
                  <ActionOption
                    active={action === "create_addendum"}
                    onClick={() => setAction("create_addendum")}
                    icon={<FileText className="h-4 w-4" />}
                    title="Criar aditamento"
                    description="Novo instrumento jurídico vinculado ao CCV assinado, herda template+style. Mesmas partes + opção de interveniente. Vai pra assinatura separada."
                  />
                ) : (
                  <ActionOption
                    active={action === "draft_edit"}
                    onClick={() => setAction("draft_edit")}
                    icon={<Edit3 className="h-4 w-4" />}
                    title="Aplicar no contrato (rascunho)"
                    description="Adiciona a cláusula direto no CCV em rascunho, antes da assinatura. Ancorado em local relevante via propose_suggestion."
                  />
                )}
                <ActionOption
                  active={action === "comment_only"}
                  onClick={() => setAction("comment_only")}
                  icon={<MessageSquare className="h-4 w-4" />}
                  title="Apenas comentar"
                  description="Registra um comentário no contrato sem alterar o texto. Útil pra documentar achado sem ação imediata."
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium block mb-1">
                Descreva o que você quer (opcional)
              </label>
              <p className="text-xs text-muted-foreground mb-2">
                Se omitido, a IA usa o texto-base auditado acima. Use pra refinar
                prazo, valor, condições específicas, etc.
              </p>
              <Textarea
                value={userDescription}
                onChange={(e) => setUserDescription(e.target.value)}
                placeholder="Ex: Quero que o prazo de quitação seja 30 dias antes da escritura, com retenção em conta vinculada."
                rows={4}
                className="text-sm"
              />
            </div>
          </>
        )}

        {/* Caso 3: nem suggestion nem clarification — apenas comentar */}
        {!hasSuggestion && !hasClarification && (
          <div className="text-sm text-muted-foreground">
            Este finding é puramente informativo. Você pode registrar um comentário pra
            referência futura.
          </div>
        )}

        {finding.manual_action?.url && (
          <a
            href={finding.manual_action.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-700 hover:underline inline-flex items-center gap-1"
          >
            🔗 {finding.manual_action.label}
          </a>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            <X className="h-3 w-3 mr-1" />
            Cancelar
          </Button>
          {(hasSuggestion || hasClarification) && (
            <Button
              onClick={handleSubmit}
              disabled={submitting}
              variant={action === "comment_only" ? "outline" : "default"}
            >
              <Sparkles className="h-3 w-3 mr-1" />
              {submitting
                ? "Processando…"
                : action === "comment_only"
                ? "Registrar comentário"
                : "Processar com IA"}
            </Button>
          )}
        </div>

        <div className="text-[10px] text-muted-foreground font-mono pt-2 border-t">
          deal={dealId.slice(0, 12)}… · contract={contractId.slice(0, 12)}…
          {finding.jobId && ` · job=${finding.jobId.slice(0, 12)}…`}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ActionOption({
  active,
  onClick,
  icon,
  title,
  description,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
        active
          ? "border-violet-400 bg-violet-50 ring-1 ring-violet-300"
          : "border-gray-200 hover:bg-gray-50"
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <div className="font-medium text-sm">{title}</div>
      </div>
      <div className="text-xs text-muted-foreground">{description}</div>
    </button>
  );
}

function buildAgentPrompt(
  action: Action,
  finding: Finding,
  userDescription: string
): string {
  const target = finding.target ? ` (${finding.target})` : "";
  const desc = userDescription.trim();
  const descBlock = desc ? `\n\nDescrição do usuário: ${desc}` : "";

  if (action === "create_addendum") {
    return `Crie um aditamento contratual baseado no finding ${finding.kind}${target}. Mensagem: ${finding.message}. Use o suggested_aditamento desse finding como base operativa e siga o template aditamento_v2.hbs herdando partes+style do CCV original.${descBlock} Job de origem: ${finding.jobId ?? "n/a"}.`;
  }

  // draft_edit
  return `Aplique aditamento no contrato em rascunho por causa do finding ${finding.kind}${target} — ${finding.message}. Use o suggested_aditamento desse finding como base e ancore num local relevante (cláusula de irrevogabilidade ou no final). Não crie aditamento separado — adicione direto no documento original.${descBlock} Job de origem: ${finding.jobId ?? "n/a"}.`;
}
