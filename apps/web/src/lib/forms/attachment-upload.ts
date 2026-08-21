import { upload } from "@vercel/blob/client";

/**
 * Upload de anexo do formulário — a parte que não depende de quem chama.
 *
 * Nasceu dentro do DocumentosStep e saiu de lá quando o bloco da matrícula
 * (etapa Imóvel) passou a precisar do mesmo pipeline: as regras de tamanho,
 * tipo e redimensionamento têm que ser as MESMAS nos dois pontos de entrada,
 * senão um arquivo aceito numa tela é recusado na outra pelo servidor.
 */

// 20MB de verdade: o upload é client-direct pro Blob (`attachments/blob-upload`
// + `/finalize`), então o arquivo não passa pelo corpo da função e o teto de
// ~4.5MB da Vercel deixou de valer.
export const MAX_BYTES = 20 * 1024 * 1024;
export const RESIZE_MAX_SIDE = 1500;
const IMAGE_JPEG_QUALITY = 0.8;
export const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const ACCEPTED_MIMES = [...IMAGE_MIMES, "application/pdf"];

/**
 * Reduz foto de celular antes de subir. Falha de canvas devolve o arquivo
 * original — pior upload é melhor que upload nenhum.
 */
export async function resizeImage(file: File, maxSide: number): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const longest = Math.max(width, height);
    if (longest <= maxSide) return file;
    const ratio = maxSide / longest;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", IMAGE_JPEG_QUALITY)
    );
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
      type: "image/jpeg",
    });
  } catch {
    return file;
  }
}

/** Resposta do `/finalize` — mesma forma do POST clássico de anexos. */
export interface FinalizedAttachment {
  id: string;
  filename: string;
  mime: string;
  status: string;
  fileUrl: string;
  /** `true` quando o SHA-256 já tinha OCR na org: extração vem junto. */
  cached: boolean;
  category: string | null;
  extractedData: {
    fields?: Record<string, unknown> | null;
    confidence?: number | null;
  } | null;
}

/**
 * Sobe um arquivo e cria o FormAttachment.
 *
 * `endpointBase` é a raiz dos anexos do formulário
 * (`/api/forms/<token>/attachments`). O OCR NÃO é enfileirado aqui: o anexo
 * nasce `awaiting_user` e só roda quando alguém pedir (`/[id]/retry`), que é o
 * que mantém o custo de tokens sob controle.
 */
export async function uploadFormAttachment(
  endpointBase: string,
  rawFile: File
): Promise<FinalizedAttachment> {
  const file = IMAGE_MIMES.includes(rawFile.type)
    ? await resizeImage(rawFile, RESIZE_MAX_SIDE)
    : rawFile;

  // Pathname sem o token: a URL do Blob é pública e permanente, e o token do
  // formulário é segredo. O `addRandomSuffix` do handshake garante unicidade.
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const blob = await upload(`form-attachments/${Date.now()}-${safeName}`, file, {
    access: "public",
    handleUploadUrl: `${endpointBase}/blob-upload`,
    contentType: file.type,
  });

  const res = await fetch(`${endpointBase}/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: blob.url,
      filename: file.name,
      mime: file.type,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Falha no upload"
    );
  }
  return data as FinalizedAttachment;
}

/** Motivo pelo qual um arquivo foi recusado antes de subir, ou `null`. */
export function rejectFileReason(file: File): string | null {
  if (!ACCEPTED_MIMES.includes(file.type)) {
    return `${file.name}: formato não suportado (use PDF, JPG, PNG ou WEBP)`;
  }
  if (file.size > MAX_BYTES) {
    return `${file.name}: arquivo maior que 20MB`;
  }
  return null;
}
