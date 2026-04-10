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
import { Download, FileText, File, ExternalLink } from "lucide-react";
import { toast } from "sonner";

interface ExportDialogProps {
  contractId: string;
  exports: { id: string; format: string; url: string; createdAt: string }[];
}

export function ExportDialog({ contractId, exports }: ExportDialogProps) {
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    const res = await fetch(`/api/contracts/${contractId}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "all" }),
    });
    setExporting(false);

    if (res.ok) {
      toast.success("Exportacao concluida!");
      window.location.reload();
    } else {
      toast.error("Erro na exportacao");
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
          <Button
            className="w-full justify-start"
            variant="outline"
            onClick={handleExport}
            disabled={exporting}
          >
            <FileText className="h-4 w-4 mr-2" />
            {exporting ? "Exportando..." : "Gerar PDF + DOCX"}
          </Button>

          {exports.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Exportacoes anteriores:</p>
              {exports.map((exp) => (
                <a
                  key={exp.id}
                  href={exp.url}
                  target="_blank"
                  className="flex items-center gap-2 rounded border p-2 hover:bg-muted/50 transition-colors"
                >
                  {exp.format === "pdf" ? (
                    <FileText className="h-4 w-4 text-red-500" />
                  ) : (
                    <File className="h-4 w-4 text-blue-500" />
                  )}
                  <span className="text-sm flex-1">
                    {exp.format.toUpperCase()}
                  </span>
                  <Badge variant="secondary" className="text-xs">
                    {new Date(exp.createdAt).toLocaleDateString("pt-BR")}
                  </Badge>
                  <ExternalLink className="h-3 w-3" />
                </a>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
