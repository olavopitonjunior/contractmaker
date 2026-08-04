/**
 * Tradução de erro da API REST para frase de negócio em português.
 *
 * Por que existe: o que este módulo devolve chega, quase literal, no WhatsApp
 * de um corretor. Em 2026-08-04 o Newton tentou criar uma proposta 3× seguidas
 * e desistiu — a rota respondia 400 com o `.message` cru do Zod (um JSON
 * stringificado de issues) e o handler da tool descartava o status HTTP, então
 * o modelo não sabia sequer que tinha falhado.
 *
 * Duas regras, nesta ordem de importância:
 *  1. NUNCA vazar interno — nome de campo, path, JSON, id, stack. Se não houver
 *     tradução conhecida, cai numa frase genérica; jamais no corpo cru.
 *  2. Dizer o que a PESSOA precisa fazer, não o que o schema esperava.
 */

/** Issue do Zod, no shape que `POST /api/proposals` passou a devolver. */
interface ZodIssueLike {
  path?: Array<string | number>;
  code?: string;
  message?: string;
}

interface ApiResult {
  status: number;
  body: unknown;
}

export interface ApiErrorExplanation {
  _error: true;
  status: number;
  message: string;
}

const GENERIC = "Não consegui registrar a proposta com esses dados.";

/**
 * Path do Zod → frase. A chave é o path com os índices de array normalizados
 * (`signers.0.role` → `signers.role`), pra uma regra cobrir qualquer posição.
 */
const BY_FIELD: Record<string, string> = {
  "signers.role":
    "Falta dizer o papel de cada pessoa — quem está propondo e quem é o dono do imóvel.",
  "signers.name": "Falta o nome de uma das pessoas envolvidas.",
  "signers.notifyChannel":
    "Não entendi por onde avisar uma das pessoas. Pode ser WhatsApp ou e-mail.",
  signers: "Preciso saber quem são as pessoas envolvidas na proposta.",
  title: "Falta um título para a proposta.",
  schemaType: "Preciso saber se é proposta de compra ou de locação.",
  validUntil: "A data de validade não foi entendida.",
  dataJson: "Os dados da proposta não vieram no formato esperado.",
};

/** Mensagens por status, quando não há issues de validação pra traduzir. */
const BY_STATUS: Record<number, string> = {
  401: "Não estou autorizado a fazer isso agora.",
  403: "Não tenho permissão para isso nesta conta.",
  404: "Não encontrei essa proposta.",
  // 409 cobre dois casos distintos nas propostas; o texto do servidor é mais
  // específico que qualquer coisa que eu monte aqui, então ele tem precedência
  // (ver `serverMessageFor409`) e isto é só o fallback.
  409: "Não deu pra fazer essa alteração no estado atual da proposta.",
  422: "Faltam informações para seguir com o envio.",
  429: "Muitas tentativas seguidas. Tente de novo em instantes.",
};

/**
 * Alguns 4xx da API trazem uma frase escrita PARA o usuário — "Duas pessoas têm
 * o mesmo contato…", "A ClickSign não permite trocar o contato depois de
 * enviado…". Essa frase é melhor que qualquer genérico daqui, e perdê-la foi o
 * que deixou o agente sem saber o que fazer no primeiro incidente.
 *
 * Repassar cru continua PROIBIDO por padrão (era assim que vazava JSON do Zod e
 * erro de Prisma). Só passa o que parece frase humana: sem JSON, sem stack, sem
 * identificador de sistema, e curta.
 */
function humanServerMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { error?: unknown }).error;
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > 300) return null;
  if (/^[[{]/.test(s)) return null; // JSON stringificado
  if (/\bat \w+ \(|Prisma|\bP\d{4}\b|Error:|undefined|_id\b|[{}]/.test(s)) return null;
  if (!/[a-záéíóúâêôãõç]/i.test(s)) return null; // precisa parecer texto
  return s;
}

function normalizePath(path: Array<string | number> | undefined): string {
  if (!path?.length) return "";
  return path.filter((p) => typeof p !== "number").join(".");
}

function extractIssues(body: unknown): ZodIssueLike[] {
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;

  if (Array.isArray(b.issues)) return b.issues as ZodIssueLike[];

  // Fallback pra API ainda não atualizada, que só mandava `error` com o
  // `.message` do Zod — que é um JSON stringificado das issues.
  if (typeof b.error === "string") {
    try {
      const parsed: unknown = JSON.parse(b.error);
      if (Array.isArray(parsed)) return parsed as ZodIssueLike[];
    } catch {
      /* não era JSON — segue sem issues */
    }
  }
  return [];
}

/**
 * Devolve `null` quando a resposta foi bem-sucedida (o chamador segue usando o
 * corpo normal). Em erro, devolve a explicação já pronta para o modelo repassar.
 */
export function explainApiError(r: ApiResult): ApiErrorExplanation | null {
  if (r.status < 400) return null;

  const issues = extractIssues(r.body);
  const messages: string[] = [];
  for (const issue of issues) {
    const key = normalizePath(issue.path);
    const phrase = BY_FIELD[key];
    if (phrase && !messages.includes(phrase)) messages.push(phrase);
  }

  // Issues que não sabemos traduzir não viram texto cru: se NENHUMA casou, cai
  // no genérico. Melhor um pedido vago que um vazamento de schema no WhatsApp.
  // Antes do genérico, porém, vale a frase que o servidor escreveu para o
  // usuário — quando ela existe, é mais útil que qualquer texto daqui.
  const message =
    messages.length > 0
      ? messages.join(" ")
      : humanServerMessage(r.body) ?? BY_STATUS[r.status] ?? GENERIC;

  return { _error: true, status: r.status, message };
}
