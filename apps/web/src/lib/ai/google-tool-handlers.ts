import { batchUpdateDoc, getDocPlainText, getDocStructure } from "@/lib/google/docs";
import { createAnchoredComment } from "@/lib/google/comments";
import type { docs_v1 } from "googleapis";

/**
 * Implementações das tools de edição que mutam o conteúdo do contrato via
 * Google Docs API (Drive + Docs). Cada função recebe o `docId` do contrato
 * e retorna `{ success, ... }` para o agente. As tool-handlers principais
 * delegam para cá quando `context.googleDocId` está setado.
 */

/**
 * Helper interno: envolve handlers Google em try/catch padronizado.
 * Drive/Docs API podem lançar (rate limit, doc deletado, perm revogada,
 * trecho não encontrado quando re-buscamos índices). Sem isso, a exception
 * sobe pelo executeToolHandler → loop do agent → /chat 500 (visto no QA #1
 * com googleProposeSuggestion). Retornar `{ error }` deixa o agente fazer
 * fallback gracioso na próxima iteração.
 */
async function safeGoogleCall(
  label: string,
  fn: () => Promise<Record<string, unknown>>
): Promise<Record<string, unknown>> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[google-tool] ${label} falhou:`, msg);
    return {
      error: `Falha em ${label}: ${msg.slice(0, 200)}`,
      googleApiError: true,
    };
  }
}

export async function googleEditSection(
  docId: string,
  selectedText: string,
  newText: string
): Promise<Record<string, unknown>> {
  return safeGoogleCall("googleEditSection", async () => {
    const text = await getDocPlainText(docId);
    if (!text.includes(selectedText)) {
      return {
        error: `Texto não encontrado no doc: "${selectedText.slice(0, 80)}…". Use add_comment para sinalizar e validar primeiro.`,
      };
    }

    const requests: docs_v1.Schema$Request[] = [
      {
        replaceAllText: {
          containsText: { text: selectedText, matchCase: true },
          replaceText: newText,
        },
      },
    ];
    const res = await batchUpdateDoc(docId, requests);
    const replaced = res.data.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0;
    return { success: replaced > 0, occurrencesChanged: replaced };
  });
}

export async function googleInsertClause(
  docId: string,
  clauseHtml: string,
  options: { afterText?: string; atEnd?: boolean }
): Promise<Record<string, unknown>> {
  return safeGoogleCall("googleInsertClause", async () => {
    const doc = await getDocStructure(docId);
    const plain = clauseHtmlToPlain(clauseHtml);
    let insertIndex: number;

    if (options.afterText) {
      const range = findFirstRange(doc, options.afterText);
      if (!range) {
        return { error: `Texto âncora não encontrado: "${options.afterText.slice(0, 80)}…"` };
      }
      insertIndex = range.endIndex;
    } else {
      const last = doc.body?.content?.[doc.body.content.length - 1];
      insertIndex = (last?.endIndex || 1) - 1;
    }

    const requests: docs_v1.Schema$Request[] = [
      {
        insertText: {
          text: `\n${plain}\n`,
          location: { index: insertIndex },
        },
      },
    ];
    await batchUpdateDoc(docId, requests);

    // Verificação pós-mutação: releitura do doc e checagem de que o trecho
    // realmente apareceu. Drive insertText nunca lança em índice válido, mas
    // pode ficar misalinhado se o usuário tiver editado entre getDocStructure
    // e batchUpdateDoc. Sem releitura o agente acreditaria que aplicou e
    // declararia o turn um sucesso.
    const probe = plain.slice(0, 80).trim();
    if (probe.length >= 12) {
      const after = await getDocPlainText(docId);
      if (!after.includes(probe)) {
        return {
          success: false,
          error: "Inserção não verificada: trecho não foi encontrado após o batchUpdate. Doc pode ter sido editado em paralelo.",
          verified: false,
          insertedAt: insertIndex,
        };
      }
    }

    return { success: true, insertedAt: insertIndex, verified: true };
  });
}

export async function googleRemoveClause(
  docId: string,
  clauseText: string
): Promise<Record<string, unknown>> {
  return safeGoogleCall("googleRemoveClause", async () => {
    const doc = await getDocStructure(docId);
    const range = findFirstRange(doc, clauseText);
    if (!range) {
      return { error: `Cláusula não encontrada: "${clauseText.slice(0, 80)}…"` };
    }

    const requests: docs_v1.Schema$Request[] = [
      {
        deleteContentRange: {
          range: { startIndex: range.startIndex, endIndex: range.endIndex },
        },
      },
    ];
    await batchUpdateDoc(docId, requests);

    // Verificação pós-mutação: confirma que o trecho NÃO aparece mais. Probe
    // usa as primeiras 80 chars do texto removido — colisão fortuita com
    // outro parágrafo é extremamente improvável nesse tamanho.
    const probe = clauseText.slice(0, 80).trim();
    if (probe.length >= 12) {
      const after = await getDocPlainText(docId);
      if (after.includes(probe)) {
        return {
          success: false,
          error: "Remoção não confirmada: trecho ainda aparece no doc após o batchUpdate. Doc pode ter sido editado em paralelo.",
          verified: false,
          removedRange: range,
        };
      }
    }

    return { success: true, removedRange: range, verified: true };
  });
}

export async function googleAddComment(
  docId: string,
  selectedText: string,
  content: string
): Promise<Record<string, unknown>> {
  try {
    const result = await createAnchoredComment({ docId, selectedText, content });
    return { success: true, commentId: result.id };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Cria uma "suggestion" como Drive comment estruturado, ancorado no trecho
 * `selectedText`. O modo nativo de track changes ("suggesting") exige que a
 * service account tenha permissão `commenter` (não `writer`) — incompatível
 * com o fluxo atual onde a service account é dona/editor do doc. Como
 * workaround pragmático, emitimos um comment formatado que o usuário pode
 * aceitar/rejeitar via thread do próprio Drive.
 *
 * Quando o usuário aceitar (no momento de resolver `ContractSuggestion`), o
 * código do endpoint `/api/contracts/[id]/suggestions/[suggestionId]` PATCH
 * com `action: "accept"` aplica `replaceAllText`/`insertText`/`deleteContentRange`
 * ao doc.
 */
export async function googleProposeSuggestion(
  docId: string,
  payload: { type: "insertion" | "deletion" | "replacement"; selectedText?: string; newText?: string; reason?: string }
): Promise<Record<string, unknown>> {
  const { type, selectedText, newText, reason } = payload;
  if (!selectedText) {
    return { error: "selectedText obrigatório para suggestion no Google Doc" };
  }

  const body =
    `[SUGESTÃO IA · ${type}]\n` +
    (newText ? `Substituir por: "${newText}"\n` : "") +
    (reason ? `Motivo: ${reason}\n` : "") +
    `\n— Aceite via "Aceitar sugestões" no painel do app.`;

  // createAnchoredComment lança quando o trecho não está visível no doc
  // (ex.: usuário editou o doc após o agente carregar o htmlContent). Sem
  // try/catch a exception derruba o request /chat com 500 — converter em
  // tool result `error` deixa o agente fazer fallback gracioso na próxima
  // iteração do loop.
  try {
    const result = await createAnchoredComment({
      docId,
      selectedText,
      content: body,
    });
    return {
      success: true,
      googleCommentId: result.id,
      type,
      note: "Suggestion criada como comment ancorado no Google Doc; aplicar via accept no painel.",
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      note:
        "Trecho de referência não foi localizado no doc atual. Confirme com o usuário o texto exato ou use add_comment com um trecho que já apareça visivelmente.",
    };
  }
}

interface Range {
  startIndex: number;
  endIndex: number;
}

function findFirstRange(
  doc: docs_v1.Schema$Document,
  needle: string
): Range | null {
  const trimmed = needle.trim();
  if (!trimmed) return null;
  for (const block of doc.body?.content || []) {
    const para = block.paragraph;
    if (!para) continue;
    for (const el of para.elements || []) {
      const tr = el.textRun;
      if (!tr || !tr.content) continue;
      const idx = tr.content.indexOf(trimmed);
      if (idx >= 0 && el.startIndex !== undefined && el.startIndex !== null) {
        const start = el.startIndex + idx;
        return { startIndex: start, endIndex: start + trimmed.length };
      }
    }
  }
  return null;
}

/**
 * Aplica um DocumentStyle preset ao Google Doc inteiro: fonte, tamanho-base,
 * line-height, cor primária, e margens da página. Equivalente ao wrapper HTML
 * que `handleApplyStylePreset` faz quando o contrato é TipTap.
 */
export async function googleApplyStylePreset(
  docId: string,
  preset: {
    fontFamily: string;
    fontSizeBase: number;
    lineHeight: number;
    colorPrimary?: string | null;
    marginTopMm?: number | null;
    marginBottomMm?: number | null;
    marginLeftMm?: number | null;
    marginRightMm?: number | null;
  }
): Promise<Record<string, unknown>> {
  return safeGoogleCall("googleApplyStylePreset", async () => {
  const doc = await getDocStructure(docId);
  const lastEnd = lastBodyEndIndex(doc);
  if (lastEnd <= 1) {
    return { error: "Doc vazio — não há texto para estilizar." };
  }

  const requests: docs_v1.Schema$Request[] = [];

  // Estilo de texto em todo o body
  const textStyleFields: string[] = ["weightedFontFamily", "fontSize"];
  const textStyle: docs_v1.Schema$TextStyle = {
    weightedFontFamily: { fontFamily: preset.fontFamily },
    fontSize: { magnitude: preset.fontSizeBase, unit: "PT" },
  };
  if (preset.colorPrimary) {
    const rgb = hexToRgb(preset.colorPrimary);
    if (rgb) {
      textStyle.foregroundColor = { color: { rgbColor: rgb } };
      textStyleFields.push("foregroundColor");
    }
  }
  requests.push({
    updateTextStyle: {
      range: { startIndex: 1, endIndex: lastEnd },
      textStyle,
      fields: textStyleFields.join(","),
    },
  });

  // Line-height em todos os parágrafos
  requests.push({
    updateParagraphStyle: {
      range: { startIndex: 1, endIndex: lastEnd },
      paragraphStyle: { lineSpacing: preset.lineHeight * 100 },
      fields: "lineSpacing",
    },
  });

  // Alinhamento justificado em todos os parágrafos (padrão de contratos
  // formais brasileiros — corpo do contrato totalmente justificado).
  requests.push({
    updateParagraphStyle: {
      range: { startIndex: 1, endIndex: lastEnd },
      paragraphStyle: { alignment: "JUSTIFIED" },
      fields: "alignment",
    },
  });

  // CENTER seletivo (espelha padrão da v1 Zimmermann — só os 3 paragraphs
  // de "topo" são centralizados, restante fica JUSTIFIED):
  //   - HEADING_1 sempre (título principal "INSTRUMENTO PARTICULAR...")
  //   - PRIMEIRO HEADING_2 apenas (linha "Modalidade: Pagamento À Vista")
  //   - Paragraphs decorativos (símbolos como ❦, ◆, ●) — separadores visuais
  // Cláusulas usando HEADING_2/3 ("CLÁUSULA PRIMEIRA - DO OBJETO") permanecem
  // JUSTIFIED, alinhando com layout legal tradicional.
  const blocks = doc.body?.content || [];
  let firstH2Centered = false;
  const decorativeOnly = /^[❦◆◇●○•★※\s_*-]+$/;
  for (const block of blocks) {
    const para = block.paragraph;
    if (!para) continue;
    const named = para.paragraphStyle?.namedStyleType || "";
    const text = (para.elements || [])
      .map((e) => e.textRun?.content || "")
      .join("")
      .trim();

    let shouldCenter = false;
    if (named === "HEADING_1") {
      shouldCenter = true;
    } else if (named === "HEADING_2" && !firstH2Centered) {
      shouldCenter = true;
      firstH2Centered = true;
    } else if (text.length > 0 && text.length < 10 && decorativeOnly.test(text)) {
      shouldCenter = true;
    }

    if (
      shouldCenter &&
      block.startIndex !== undefined &&
      block.endIndex !== undefined
    ) {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: block.startIndex, endIndex: block.endIndex },
          paragraphStyle: { alignment: "CENTER" },
          fields: "alignment",
        },
      });
    }
  }

  // Margens da página (mm → pt). Aplica em DocumentStyle.
  const docStyle: docs_v1.Schema$DocumentStyle = {};
  const docFields: string[] = [];
  if (preset.marginTopMm != null) {
    docStyle.marginTop = { magnitude: mmToPt(preset.marginTopMm), unit: "PT" };
    docFields.push("marginTop");
  }
  if (preset.marginBottomMm != null) {
    docStyle.marginBottom = { magnitude: mmToPt(preset.marginBottomMm), unit: "PT" };
    docFields.push("marginBottom");
  }
  if (preset.marginLeftMm != null) {
    docStyle.marginLeft = { magnitude: mmToPt(preset.marginLeftMm), unit: "PT" };
    docFields.push("marginLeft");
  }
  if (preset.marginRightMm != null) {
    docStyle.marginRight = { magnitude: mmToPt(preset.marginRightMm), unit: "PT" };
    docFields.push("marginRight");
  }
  if (docFields.length > 0) {
    requests.push({
      updateDocumentStyle: {
        documentStyle: docStyle,
        fields: docFields.join(","),
      },
    });
  }

  await batchUpdateDoc(docId, requests);

  return {
    success: true,
    appliedStyle: {
      fontFamily: preset.fontFamily,
      fontSize: preset.fontSizeBase,
      lineHeight: preset.lineHeight,
    },
    appliedMargins: docFields,
  };
  });
}

/**
 * Insere uma imagem inline no doc via `insertInlineImage`. Imagem precisa ser
 * publicamente acessível (Vercel Blob serve isso). Retorna o objectId do
 * elemento inserido pra futuras manipulações.
 */
export async function googleInsertImage(
  docId: string,
  url: string,
  options: { afterText?: string; widthPt?: number; heightPt?: number }
): Promise<Record<string, unknown>> {
  if (!/^https?:\/\//.test(url)) {
    return { error: "URL deve ser absoluta http(s) — Docs API não aceita relative paths" };
  }

  return safeGoogleCall("googleInsertImage", async () => {
  let insertIndex: number;
  if (options.afterText) {
    const doc = await getDocStructure(docId);
    const range = findFirstRangeInGoogleDoc(doc, options.afterText);
    if (!range) {
      return { error: `Texto âncora não encontrado: "${options.afterText.slice(0, 80)}…"` };
    }
    insertIndex = range.endIndex;
  } else {
    const doc = await getDocStructure(docId);
    insertIndex = Math.max(1, lastBodyEndIndex(doc) - 1);
  }

  const insertReq: docs_v1.Schema$Request = {
    insertInlineImage: {
      uri: url,
      location: { index: insertIndex },
      ...(options.widthPt || options.heightPt
        ? {
            objectSize: {
              ...(options.widthPt
                ? { width: { magnitude: options.widthPt, unit: "PT" } }
                : {}),
              ...(options.heightPt
                ? { height: { magnitude: options.heightPt, unit: "PT" } }
                : {}),
            },
          }
        : {}),
    },
  };

  const res = await batchUpdateDoc(docId, [insertReq]);
  const objectId = res.data.replies?.[0]?.insertInlineImage?.objectId;

  return {
    success: true,
    objectId,
    insertedAt: insertIndex,
  };
  });
}

function lastBodyEndIndex(doc: docs_v1.Schema$Document): number {
  const last = doc.body?.content?.[doc.body.content.length - 1];
  return last?.endIndex ?? 1;
}

function hexToRgb(hex: string): { red: number; green: number; blue: number } | null {
  const m = hex.match(/^#?([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})$/i);
  if (!m) return null;
  return {
    red: parseInt(m[1], 16) / 255,
    green: parseInt(m[2], 16) / 255,
    blue: parseInt(m[3], 16) / 255,
  };
}

function mmToPt(mm: number): number {
  // 1 mm ≈ 2.834645 pt
  return Math.round(mm * 2.834645 * 100) / 100;
}

function findFirstRangeInGoogleDoc(
  doc: docs_v1.Schema$Document,
  needle: string
): { startIndex: number; endIndex: number } | null {
  const trimmed = needle.trim();
  if (!trimmed) return null;
  for (const block of doc.body?.content || []) {
    const para = block.paragraph;
    if (!para) continue;
    for (const el of para.elements || []) {
      const tr = el.textRun;
      if (!tr || !tr.content) continue;
      const idx = tr.content.indexOf(trimmed);
      if (idx >= 0 && el.startIndex !== undefined && el.startIndex !== null) {
        const start = el.startIndex + idx;
        return { startIndex: start, endIndex: start + trimmed.length };
      }
    }
  }
  return null;
}

/** Converte HTML simples (do banco de cláusulas) em texto plano com quebras
 *  de linha — placeholder até Phase 7 reconstruir cláusulas em formato Docs. */
function clauseHtmlToPlain(html: string): string {
  return html
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
