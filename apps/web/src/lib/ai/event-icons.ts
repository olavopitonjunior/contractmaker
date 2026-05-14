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
  query_clauses: { icon: Search, label: "Consultou banco de cláusulas", kind: "kb" },
  query_templates: { icon: FileSearch, label: "Consultou templates", kind: "kb" },
  explain_clause: { icon: BookOpen, label: "Explicou cláusula", kind: "kb" },
  query_knowledge_base: { icon: BookOpen, label: "Consultou base de conhecimento", kind: "kb" },
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
};

const FALLBACK: ToolDescriptor = {
  icon: CheckCircle2,
  label: "Executou ferramenta",
  kind: "analyze",
};

export function describeTool(name: string): ToolDescriptor {
  return TOOL_REGISTRY[name] || { ...FALLBACK, label: `Executou ${name}` };
}

/** Classes Tailwind por kind — usadas pra colorir chips. */
export const KIND_CLASSES: Record<ToolDescriptor["kind"], string> = {
  kb: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-300",
  edit: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300",
  suggest: "border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-900/50 dark:bg-purple-950/30 dark:text-purple-300",
  analyze: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300",
  design: "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900/50 dark:bg-cyan-950/30 dark:text-cyan-300",
};
