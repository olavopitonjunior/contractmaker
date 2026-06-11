// Shapes do laudo de vistoria (Inspection.ambientesJson / checklistJson).
// Client-safe: só tipos e helpers puros — sem Prisma.

export interface LaudoFoto {
  url: string;
  legenda?: string;
  uploadedAt: string; // ISO
}

export type LaudoEstado = "novo" | "bom" | "regular" | "ruim";

export interface LaudoItem {
  id: string;
  nome: string;
  estado: LaudoEstado;
  observacoes?: string;
  fotos: LaudoFoto[];
}

export interface LaudoAmbiente {
  id: string;
  nome: string;
  ordem: number;
  observacoes?: string;
  fotos: LaudoFoto[];
  itens: LaudoItem[];
}

export interface LaudoMedidor {
  leitura: string;
  fotoUrl?: string;
}

export interface LaudoMeta {
  medidores: Partial<Record<"agua" | "luz" | "gas", LaudoMedidor>>;
  chaves: Array<{ tipo: string; quantidade: number }>;
  mobilia: Array<{ item: string; quantidade: number; estado: string }>;
  observacoesGerais?: string;
  /** Impresso no laudo. Default 7 dias. */
  prazoContestacaoDias?: number;
}

export const LAUDO_ESTADOS: LaudoEstado[] = ["novo", "bom", "regular", "ruim"];

export const LAUDO_ESTADO_LABELS: Record<LaudoEstado, string> = {
  novo: "Novo",
  bom: "Bom",
  regular: "Regular",
  ruim: "Ruim",
};

export const INSPECTION_STATUSES = [
  "rascunho",
  "em_campo",
  "laudo_gerado",
  "assinatura",
  "concluida",
] as const;

export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

export const INSPECTION_STATUS_LABELS: Record<InspectionStatus, string> = {
  rascunho: "Rascunho",
  em_campo: "Em campo",
  laudo_gerado: "Laudo gerado",
  assinatura: "Em assinatura",
  concluida: "Concluída",
};

// Workflow: rascunho → em_campo → laudo_gerado → assinatura → concluida.
// Regressões permitidas só pra reabrir edição antes da assinatura;
// assinatura→laudo_gerado acontece via cancelamento do envelope.
const ALLOWED_TRANSITIONS: Record<InspectionStatus, InspectionStatus[]> = {
  rascunho: ["em_campo"],
  em_campo: ["laudo_gerado", "rascunho"],
  laudo_gerado: ["em_campo", "assinatura"],
  assinatura: ["laudo_gerado"],
  concluida: [],
};

export function canTransitionInspection(from: string, to: string): boolean {
  if (from === to) return true;
  const allowed = ALLOWED_TRANSITIONS[from as InspectionStatus];
  return Array.isArray(allowed) && allowed.includes(to as InspectionStatus);
}

/** Conteúdo do laudo só é editável antes do envio pra assinatura. */
export function isInspectionContentEditable(status: string): boolean {
  return status === "rascunho" || status === "em_campo" || status === "laudo_gerado";
}

/** Ambientes sugeridos no editor (o vistoriador pode adicionar outros). */
export const AMBIENTES_SUGERIDOS = [
  "Sala",
  "Cozinha",
  "Quarto",
  "Banheiro",
  "Área de serviço",
  "Varanda",
  "Garagem",
  "Área externa",
];
