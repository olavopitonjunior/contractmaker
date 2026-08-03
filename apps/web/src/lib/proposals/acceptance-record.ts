/**
 * Registro do Aceite — o artefato OFICIAL da ClickSign para o Aceite via
 * WhatsApp (provas de identidade do destinatário + mensagens trocadas).
 *
 * Contexto: o Aceite é um produto SEPARADO do envelope — a pessoa aceita um
 * texto + link, não assina um PDF. Logo não existe `Envelope.signedDocumentUrl`
 * e nada da maquinaria de PDF assinado roda. A ClickSign *gera* o Registro do
 * Aceite, mas até hoje só o expõe na interface web (Aceites → Via WhatsApp →
 * histórico): a API v3 documentada (`GET /api/v3/acceptance_term/whatsapps/{id}`)
 * devolve apenas metadados — signer_*, sender_*, status, status_flow, title,
 * message, sent_at, created, modified. NENHUM campo de link.
 *
 * Este módulo é a aposta barata: varre a resposta REAL atrás de qualquer campo
 * de download que a doc não liste. Se a ClickSign publicar o campo (ou já o
 * devolver sem documentar), o anexo passa a entrar sozinho, sem mudar código.
 * Enquanto não devolver, `extractAcceptanceRecordUrl` retorna null e o caminho
 * é o upload manual pela UI da proposta.
 *
 * PURO e sem I/O de propósito — é o pedaço testável.
 */

/** Chaves que sugerem um artefato baixável. */
const KEY_HINT = /(url|link|download|report|evidence|evidencia|record|registro|document|file|pdf)/i;

/** Só aceita HTTPS: um link `http:` viraria downgrade e o safeFetch recusaria. */
function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Procura, em profundidade, a primeira URL https cuja CHAVE (ou a chave do
 * objeto que a contém, no caso de `links: { self, record }`) sugira um artefato.
 *
 * Busca em largura para preferir os campos rasos (`data.links.record`) aos
 * profundos. Profundidade limitada — a resposta é pequena e um payload hostil
 * não pode virar varredura infinita.
 */
export function extractAcceptanceRecordUrl(resp: unknown): string | null {
  const queue: Array<{ node: unknown; keyPath: string; depth: number }> = [
    { node: resp, keyPath: "", depth: 0 },
  ];

  while (queue.length > 0) {
    const { node, keyPath, depth } = queue.shift() as (typeof queue)[number];
    if (depth > 6 || node == null || typeof node !== "object") continue;

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      // A chave da URL vale, mas `links: { self: "..." }` também: ali quem
      // carrega a semântica é o container. Por isso o keyPath acumulado.
      const path = keyPath ? `${keyPath}.${key}` : key;
      if (isHttpsUrl(value) && KEY_HINT.test(path)) return value;
      if (value != null && typeof value === "object") {
        queue.push({ node: value, keyPath: path, depth: depth + 1 });
      }
    }
  }

  return null;
}

/** Atributos oficiais do aceite, para carimbar no comprovante. */
export interface AcceptanceOfficialFacts {
  status?: string | null;
  statusFlow?: string | null;
  /** Texto EXATO como a ClickSign registrou — a base de comparação probatória. */
  message?: string | null;
  signerName?: string | null;
  signerPhone?: string | null;
  sentAt?: string | null;
}

/**
 * Lê os atributos do shape JSON:API (`data.attributes`). Tolerante: qualquer
 * campo ausente vira undefined e o comprovante cai no comportamento antigo.
 */
export function extractAcceptanceFacts(resp: unknown): AcceptanceOfficialFacts {
  const attrs = (resp as { data?: { attributes?: Record<string, unknown> } })?.data
    ?.attributes;
  if (!attrs || typeof attrs !== "object") return {};
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;
  return {
    status: str(attrs.status),
    statusFlow: str(attrs.status_flow),
    message: str(attrs.message),
    signerName: str(attrs.signer_name),
    signerPhone: str(attrs.signer_phone),
    sentAt: str(attrs.sent_at),
  };
}
