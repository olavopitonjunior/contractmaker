"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import {
  IMAGE_MIMES,
  RESIZE_MAX_SIDE,
  rejectFileReason,
  resizeImage,
} from "@/lib/forms/attachment-upload";

interface PartyOption {
  value: string;
  label: string;
}

interface PublicDoc {
  id: string;
  filename: string;
  mime: string;
  status: string;
  createdAt: string;
  assignment: { kind: string; index: number };
}

interface Props {
  token: string;
  /** Opções "de quem é" calculadas no servidor a partir da proposta. */
  options: PartyOption[];
}

const BLOB_PREFIX = "proposal-attachments/public/";

/**
 * "Envie seus documentos" na página pública da proposta de locação.
 *
 * Estilo inline como o resto da página (`page.tsx` não usa Tailwind: é o
 * inteiro teor do Aceite, renderizado a partir de um snapshot). O lead escolhe
 * de quem é o documento (locatário, cônjuge, fiador…), sobe PDF/imagem, vê o
 * que já enviou e pode remover. A imobiliária vê tudo em "Documentos por
 * parte" com a marca "enviado pelo cliente".
 */
export function PublicDocumentsBlock({ token, options }: Props) {
  const base = `/api/public/proposals/${token}/attachments`;
  const [docs, setDocs] = useState<PublicDoc[]>([]);
  const [assignment, setAssignment] = useState(options[0]?.value ?? "locatario:0");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const labelOf = useMemo(() => new Map(options.map((o) => [o.value, o.label])), [options]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(base, { cache: "no-store" });
      if (!res.ok) return;
      const d = (await res.json()) as { attachments: PublicDoc[] };
      setDocs(d.attachments ?? []);
    } catch {
      /* lista é conveniência; falha silenciosa */
    }
  }, [base]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    const [kind, idxStr] = assignment.split(":");
    const assign = { kind, index: Number.parseInt(idxStr, 10) || 0 };
    setBusy(true);
    const out: string[] = [];
    let ok = 0;
    for (const raw of list) {
      const reason = rejectFileReason(raw);
      if (reason) {
        out.push(reason);
        continue;
      }
      try {
        const file = IMAGE_MIMES.includes(raw.type) ? await resizeImage(raw, RESIZE_MAX_SIDE) : raw;
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const blob = await upload(`${BLOB_PREFIX}${Date.now()}-${safeName}`, file, {
          access: "public",
          contentType: file.type,
          handleUploadUrl: `${base}/blob-upload`,
        });
        const res = await fetch(`${base}/finalize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: blob.url, filename: file.name, mime: file.type, assignment: assign }),
        });
        const d = (await res.json().catch(() => ({}))) as { error?: string; deduped?: boolean };
        if (!res.ok) {
          out.push(`${raw.name}: ${d.error ?? "falha no envio"}`);
          continue;
        }
        ok++;
        if (d.deduped) out.push(`${raw.name}: este arquivo já tinha sido enviado.`);
      } catch (err) {
        out.push(`${raw.name}: ${err instanceof Error ? err.message : "falha no envio"}`);
      }
    }
    if (ok > 0) out.unshift(ok === 1 ? "1 documento enviado." : `${ok} documentos enviados.`);
    setMessages(out);
    setBusy(false);
    await refresh();
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`${base}/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setMessages([d.error ?? "Não foi possível remover o documento."]);
      } else {
        setMessages(["Documento removido."]);
      }
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  return (
    <section
      style={{
        marginTop: 40,
        padding: "20px 18px",
        border: "1px solid #d6d3d1",
        borderRadius: 10,
        background: "#fafaf9",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        fontSize: 15,
        color: "#1c1917",
      }}
    >
      <h2 style={{ fontSize: 18, margin: "0 0 6px", fontWeight: 600 }}>Envie seus documentos</h2>
      <p style={{ margin: "0 0 14px", color: "#57534e", fontSize: 14 }}>
        Para agilizar a análise, envie RG ou CNH, comprovante de renda e comprovante de endereço de
        cada pessoa. PDF ou imagem, até 20 MB por arquivo.
      </p>

      {options.length > 1 && (
        <label style={{ display: "block", marginBottom: 10, fontSize: 14 }}>
          De quem é o documento?{" "}
          <select
            value={assignment}
            onChange={(e) => setAssignment(e.target.value)}
            disabled={busy}
            style={{
              marginLeft: 6,
              padding: "6px 8px",
              borderRadius: 6,
              border: "1px solid #a8a29e",
              background: "#fff",
              fontSize: 14,
            }}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="application/pdf,image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files) void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        style={{
          padding: "10px 16px",
          borderRadius: 8,
          border: "1px solid #1c1917",
          background: busy ? "#e7e5e4" : "#1c1917",
          color: busy ? "#57534e" : "#fff",
          fontSize: 15,
          cursor: busy ? "default" : "pointer",
        }}
      >
        {busy ? "Enviando…" : "Escolher arquivos"}
      </button>

      {messages.length > 0 && (
        <ul style={{ margin: "12px 0 0", paddingLeft: 18, fontSize: 14, color: "#44403c" }}>
          {messages.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}

      {docs.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <p style={{ margin: "0 0 6px", fontSize: 13, color: "#78716c", textTransform: "uppercase" }}>
            Enviados ({docs.length})
          </p>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {docs.map((d) => (
              <li
                key={d.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 12,
                  padding: "6px 0",
                  borderTop: "1px solid #e7e5e4",
                  fontSize: 14,
                }}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {d.filename}
                  <span style={{ color: "#78716c" }}>
                    {" "}
                    · {labelOf.get(`${d.assignment.kind}:${d.assignment.index}`) ?? "Outro"}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove(d.id)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#b91c1c",
                    cursor: "pointer",
                    fontSize: 13,
                    padding: 0,
                  }}
                >
                  Remover
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
