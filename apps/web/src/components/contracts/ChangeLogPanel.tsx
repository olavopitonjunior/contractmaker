"use client";

import { useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquare,
  PenLine,
  Plus,
  Minus,
  Shield,
  GitBranch,
  Search,
  FileText,
  Bot,
  User,
} from "lucide-react";

interface LogEntry {
  id: string;
  action: string;
  summary: string;
  source: string;
  createdAt: string;
  user?: { name: string | null; email: string } | null;
}

const ACTION_CONFIG: Record<string, { icon: typeof Bot; color: string; label: string }> = {
  ai_edit: { icon: Bot, color: "text-purple-500", label: "Edição IA" },
  ai_query: { icon: Search, color: "text-blue-500", label: "Consulta IA" },
  manual_edit: { icon: PenLine, color: "text-orange-500", label: "Edição manual" },
  clause_added: { icon: Plus, color: "text-green-500", label: "Cláusula adicionada" },
  clause_removed: { icon: Minus, color: "text-red-500", label: "Cláusula removida" },
  status_change: { icon: Shield, color: "text-emerald-600", label: "Status alterado" },
  version_created: { icon: GitBranch, color: "text-indigo-500", label: "Nova versão" },
  data_patch: { icon: FileText, color: "text-amber-500", label: "Dados atualizados" },
  validation: { icon: Shield, color: "text-cyan-500", label: "Validação" },
  ocr_extraction: { icon: FileText, color: "text-teal-500", label: "Extração OCR" },
  human_doc_edit: { icon: PenLine, color: "text-amber-600", label: "Edição manual" },
  settings_update: { icon: FileText, color: "text-violet-500", label: "Configurações" },
  // Ping cru do watch do Drive — "documento mudou", sem dizer o quê nem quem.
  // Rotulava "Edição manual" pelo fallback, o que afirmava mais do que se sabe.
  google_doc_updated: { icon: FileText, color: "text-muted-foreground", label: "Documento atualizado" },
};

/**
 * Rótulo de autor HONESTO. Antes, qualquer entry sem `userId` virava "Sistema" —
 * inclusive `source:"user"` (edição manual detectada no Doc, cujo autor o webhook
 * do Drive não sabe). Regras:
 *  - "ai": sempre "IA" (o userId, quando existe, é quem PEDIU, não quem escreveu).
 *  - "user": nome/e-mail quando houver; senão, admite não saber.
 *  - "system": "Sistema" — mesmo com userId (que ali é só o gatilho do pipeline).
 */
export function changeLogAuthorLabel(log: {
  source: string;
  user?: { name: string | null; email: string } | null;
}): string {
  if (log.source === "ai") return "IA";
  if (log.source === "user") {
    return log.user?.name || log.user?.email || "Manual (autor não identificado)";
  }
  return "Sistema";
}

interface ChangeLogPanelProps {
  contractId: string;
}

export function ChangeLogPanel({ contractId }: ChangeLogPanelProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/contracts/${contractId}/logs`)
      .then((r) => r.json())
      .then(setLogs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [contractId]);

  if (loading) {
    return <p className="text-sm text-muted-foreground py-4">Carregando histórico...</p>;
  }

  if (logs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        Nenhuma alteração registrada ainda.
      </p>
    );
  }

  return (
    <ScrollArea className="h-[calc(100vh-200px)]">
      <div className="space-y-3 py-4 pr-4">
        {logs.map((log) => {
          const config = ACTION_CONFIG[log.action] || ACTION_CONFIG.manual_edit;
          const Icon = config.icon;
          // Só `source:"user"` é gente; "ai" e "system" são a máquina.
          const SourceIcon = log.source === "user" ? User : Bot;
          const date = new Date(log.createdAt);

          return (
            <div key={log.id} className="flex gap-3 text-sm">
              <div className={`mt-0.5 shrink-0 ${config.color}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                    {config.label}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                    <SourceIcon className="h-3 w-3" />
                    {changeLogAuthorLabel(log)}
                  </span>
                </div>
                <p className="text-muted-foreground leading-relaxed">
                  {log.summary}
                </p>
                <p className="text-[10px] text-muted-foreground/60">
                  {date.toLocaleDateString("pt-BR")} {date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
