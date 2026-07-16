/**
 * Mapeia os 11 status técnicos da proposta pra 4 estados que o corretor lê —
 * "de quem é a bola?". Os 11 vivem no banco; a UI mostra estes.
 */
export interface StatusView {
  label: string;
  /** "sua_vez" | "cliente" | "proprietario" | "encerrada" */
  bucket: "sua_vez" | "cliente" | "proprietario" | "encerrada";
  className: string;
}

const SUA_VEZ = "border-blue-500 text-blue-700";
const CLIENTE = "border-sky-400 text-sky-700";
const PROPRIETARIO = "border-amber-500 text-amber-700";
const ENCERRADA = "border-muted text-muted-foreground";
const VERDE = "border-emerald-500 text-emerald-700";

export function proposalStatusView(status: string): StatusView {
  switch (status) {
    case "rascunho":
      return { label: "Rascunho", bucket: "sua_vez", className: ENCERRADA };
    case "aguardando_aprovacao":
      return { label: "Max sugeriu", bucket: "sua_vez", className: "border-violet-500 text-violet-700" };
    case "falha_envio":
      return { label: "Falha no envio", bucket: "sua_vez", className: "border-destructive text-destructive" };
    case "enviada":
      return { label: "Enviada", bucket: "cliente", className: CLIENTE };
    case "entregue":
      return { label: "Entregue", bucket: "cliente", className: CLIENTE };
    case "visualizada":
      return { label: "Visualizou", bucket: "cliente", className: CLIENTE };
    case "assinada_proponente":
      return { label: "Aguardando vendedor", bucket: "proprietario", className: PROPRIETARIO };
    case "aguardando_vendedor":
      return { label: "Aguardando vendedor", bucket: "proprietario", className: PROPRIETARIO };
    case "completa":
      return { label: "Completa", bucket: "sua_vez", className: VERDE };
    case "convertida":
      return { label: "Virou negócio", bucket: "encerrada", className: VERDE };
    case "recusada_proponente":
      return { label: "Recusada", bucket: "encerrada", className: "border-destructive text-destructive" };
    case "recusada_vendedor":
      return { label: "Recusada pelo dono", bucket: "sua_vez", className: "border-destructive text-destructive" };
    case "expirada":
      return { label: "Expirada", bucket: "encerrada", className: ENCERRADA };
    case "cancelada":
      return { label: "Cancelada", bucket: "encerrada", className: ENCERRADA };
    default:
      return { label: status, bucket: "encerrada", className: ENCERRADA };
  }
}
