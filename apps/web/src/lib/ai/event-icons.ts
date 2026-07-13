import {
  Search,
  BookOpen,
  Pencil,
  ListPlus,
  Trash2,
  CheckCircle2,
  ShieldCheck,
  AlertTriangle,
  Lightbulb,
  MessageSquarePlus,
  FileSearch,
  GitCompare,
  Palette,
  Image as ImageIcon,
  Wrench,
  LifeBuoy,
  Wallet,
  UserCircle,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

export interface ToolDescriptor {
  icon: LucideIcon;
  label: string;
  /** Grupo semântico: define cor do chip na UI. */
  kind: "kb" | "edit" | "suggest" | "analyze" | "design";
}

/**
 * Mapa tool name → ícone/cor/label PT-BR. Usado pelo ChatPanel e
 * AiResolveDialog pra renderizar chips em tempo real estilo Claude.
 *
 * `kind` controla a cor:
 *  - kb         → azul (consulta/leitura)
 *  - edit       → âmbar (mutação direta)
 *  - suggest    → roxo (cria sugestão/comment)
 *  - analyze    → cinza (analítico, não muta)
 *  - design     → ciano (estilo / imagem)
 */
const TOOL_REGISTRY: Record<string, ToolDescriptor> = {
  // ===== Consulta / KB =====
  query_templates: { icon: FileSearch, label: "Consultou templates", kind: "kb" },
  explain_clause: { icon: BookOpen, label: "Explicou cláusula", kind: "kb" },
  query_knowledge_base: { icon: Search, label: "Consultou base de conhecimento", kind: "kb" },
  find_similar_contracts: { icon: GitCompare, label: "Buscou contratos similares", kind: "kb" },

  // ===== Edição =====
  edit_contract_section: { icon: Pencil, label: "Editou trecho do contrato", kind: "edit" },
  update_contract_data: { icon: Pencil, label: "Atualizou dados estruturados", kind: "edit" },
  insert_clause: { icon: ListPlus, label: "Inseriu cláusula", kind: "edit" },
  remove_clause: { icon: Trash2, label: "Removeu cláusula", kind: "edit" },

  // ===== Sugestões / comentários =====
  propose_suggestion: { icon: Lightbulb, label: "Propôs alteração", kind: "suggest" },
  add_comment: { icon: MessageSquarePlus, label: "Adicionou comentário", kind: "suggest" },
  propose_new_clause: { icon: Lightbulb, label: "Sugeriu nova cláusula", kind: "suggest" },
  propose_template_change: { icon: Lightbulb, label: "Sugeriu mudança no template", kind: "suggest" },

  // ===== Análise =====
  validate_contract: { icon: ShieldCheck, label: "Validou contrato", kind: "analyze" },
  suggest_improvements: { icon: Wrench, label: "Gerou sugestões de melhoria", kind: "analyze" },
  analyze_contradictions: { icon: AlertTriangle, label: "Buscou contradições", kind: "analyze" },
  extract_document_data: { icon: FileSearch, label: "Extraiu dados de documento", kind: "analyze" },

  // ===== Design / mídia =====
  apply_style_preset: { icon: Palette, label: "Aplicou preset de estilo", kind: "design" },
  insert_image: { icon: ImageIcon, label: "Inseriu imagem", kind: "design" },

  // ===== Assistente de suporte (widget) =====
  search_support_kb: { icon: Search, label: "Consultou a base de ajuda", kind: "kb" },
  request_human_handoff: { icon: LifeBuoy, label: "Encaminhou ao suporte", kind: "suggest" },
  // Tools de dados de locação (o widget de suporte também as expõe)
  query_lease_status: { icon: FileSearch, label: "Consultou o contrato", kind: "analyze" },
  summarize_owner_position: { icon: UserCircle, label: "Resumiu o proprietário", kind: "analyze" },
  forecast_cashflow: { icon: TrendingUp, label: "Projetou o fluxo de caixa", kind: "analyze" },
  suggest_dunning_strategy: { icon: Wallet, label: "Sugeriu estratégia de cobrança", kind: "analyze" },
};

const FALLBACK: ToolDescriptor = {
  icon: CheckCircle2,
  label: "Executou ferramenta",
  kind: "analyze",
};

export function describeTool(name: string): ToolDescriptor {
  return TOOL_REGISTRY[name] || { ...FALLBACK, label: `Executou ${name}` };
}

/**
 * Classes Tailwind por kind — usam CSS vars semanticos definidos em
 * globals.css sob `[data-chat-panel]`. Light + dark equivalentes vem
 * automaticamente das vars. Permite trocar a paleta inteira em 1 lugar
 * sem editar este arquivo.
 */
export const KIND_CLASSES: Record<ToolDescriptor["kind"], string> = {
  kb: "border-[hsl(var(--chat-tool-kb-border))] bg-[hsl(var(--chat-tool-kb-bg))] text-[hsl(var(--chat-tool-kb-fg))]",
  edit: "border-[hsl(var(--chat-tool-edit-border))] bg-[hsl(var(--chat-tool-edit-bg))] text-[hsl(var(--chat-tool-edit-fg))]",
  suggest: "border-[hsl(var(--chat-tool-suggest-border))] bg-[hsl(var(--chat-tool-suggest-bg))] text-[hsl(var(--chat-tool-suggest-fg))]",
  analyze: "border-[hsl(var(--chat-tool-analyze-border))] bg-[hsl(var(--chat-tool-analyze-bg))] text-[hsl(var(--chat-tool-analyze-fg))]",
  design: "border-[hsl(var(--chat-tool-design-border))] bg-[hsl(var(--chat-tool-design-bg))] text-[hsl(var(--chat-tool-design-fg))]",
};
