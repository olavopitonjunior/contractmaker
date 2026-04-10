"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Download, FileText, File, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface ExportDialogProps {
  contractId: string;
  exports: { id: string; format: string; url: string; createdAt: string }[];
}

export function ExportDialog({ contractId, exports }: ExportDialogProps) {
  const [exporting, setExporting] = useState<string | null>(null);

  async function handleExport(format: "pdf" | "docx" | "all") {
    setExporting(format);
    try {
      const res = await fetch(`/api/contracts/${contractId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format }),
      });

      if (res.ok) {
        const data = await res.json();
        toast.success("Exportacao concluida!");
        // Open the file directly
        if (format === "pdf" && data.pdfUrl) {
          window.open(data.pdfUrl, "_blank");
        } else if (format === "docx" && data.docxUrl) {
          window.open(data.docxUrl, "_blank");
        }
        window.location.reload();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Erro na exportacao");
      }
    } catch {
      toast.error("Erro de conexao");
    } finally {
      setExporting(null);
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Download className="h-4 w-4 mr-1" />
          Exportar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Exportar Contrato</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Button
              variant="outline"
              className="h-20 flex-col gap-2"
              onClick={() => handleExport("pdf")}
              disabled={exporting !== null}
            >
              {exporting === "pdf" ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <FileText className="h-6 w-6 text-red-500" />
              )}
              <span className="text-xs">Exportar PDF</span>
            </Button>
            <Button
              variant="outline"
              className="h-20 flex-col gap-2"
              onClick={() => handleExport("docx")}
              disabled={exporting !== null}
            >
              {exporting === "docx" ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <File className="h-6 w-6 text-blue-500" />
              )}
              <span className="text-xs">Exportar DOCX</span>
            </Button>
          </div>

          <Button
            className="w-full"
            onClick={() => handleExport("all")}
            disabled={exporting !== null}
          >
            {exporting === "all" ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Gerar PDF + DOCX
          </Button>

          {exports.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">
                  Exportacoes anteriores
                </p>
                {exports.map((exp) => (
                  <a
                    key={exp.id}
                    href={exp.url}
                    target="_blank"
                    className="flex items-center gap-2 rounded-md border p-2.5 hover:bg-muted/50 transition-colors"
                  >
                    {exp.format === "pdf" ? (
                      <FileText className="h-4 w-4 text-red-500 shrink-0" />
                    ) : (
                      <File className="h-4 w-4 text-blue-500 shrink-0" />
                    )}
                    <span className="text-sm flex-1">
                      {exp.format.toUpperCase()}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {new Date(exp.createdAt).toLocaleDateString("pt-BR")}
                    </Badge>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                ))}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
