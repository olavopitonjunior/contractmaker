"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Camera, X } from "lucide-react";
import type { LaudoFoto } from "@/lib/locacao/inspection-types";

interface Props {
  inspectionId: string;
  fotos: LaudoFoto[];
  onChange: (fotos: LaudoFoto[]) => void;
  disabled?: boolean;
}

/** Upload de fotos (JPEG/PNG/WebP ≤5MB) pro Blob + grid de thumbnails. */
export function FotoUploader({ inspectionId, fotos, onChange, disabled }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(files: FileList) {
    setUploading(true);
    try {
      const novas: LaudoFoto[] = [];
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`/api/locacao/inspections/${inspectionId}/photos`, {
          method: "POST",
          body: fd,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        novas.push({ url: data.url, uploadedAt: new Date().toISOString() });
      }
      onChange([...fotos, ...novas]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro no upload");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      {fotos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {fotos.map((f, i) => (
            <div key={f.url} className="group relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={f.url}
                alt={f.legenda ?? `Foto ${i + 1}`}
                className="h-16 w-16 rounded-md border object-cover"
              />
              {!disabled && (
                <button
                  type="button"
                  aria-label="Remover foto"
                  className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-destructive p-0.5 text-destructive-foreground group-hover:block"
                  onClick={() => onChange(fotos.filter((x) => x.url !== f.url))}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {!disabled && (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            <Camera className="mr-1.5 h-3.5 w-3.5" />
            {uploading ? "Enviando…" : "Adicionar fotos"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) upload(e.target.files);
              e.target.value = "";
            }}
          />
        </>
      )}
    </div>
  );
}
