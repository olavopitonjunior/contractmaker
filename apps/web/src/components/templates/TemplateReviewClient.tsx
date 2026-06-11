"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  CheckCircle2,
  Circle,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Star,
} from "lucide-react";

interface CatalogEntry {
  token: string;
  label: string;
  description: string;
  required: boolean;
  kind: "simple" | "composed";
  present: boolean;
}

interface ValidateResult {
  found: string[];
  unknown: string[];
  missingRequired: string[];
  catalog: CatalogEntry[];
}

interface TemplateInfo {
  id: string;
  name: string;
  modalidade: string;
  status: string;
  isDefault: boolean;
  docId: string;
  embedLink: string;
}

export function TemplateReviewClient({ template }: { template: TemplateInfo }) {
  const router = useRouter();
  const [validation, setValidation] = useState<ValidateResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [activating, setActivating] = useState(false);
  const [status, setStatus] = useState(template.status);
  const [isDefault, setIsDefault] = useState(template.isDefault);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const revalidate = useCallback(async () => {
    setValidating(true);
    try {
      const res = await fetch(`/api/templates/${template.id}/validate-gdoc`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha na validação");
      setValidation(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha na validação");
    } finally {
      setValidating(false);
    }
  }, [template.id]);

  useEffect(() => {
    void revalidate();
  }, [revalidate]);

  async function patchTemplate(body: Record<string, unknown>, okMsg: string) {
    setActivating(true);
    try {
      const res = await fetch(`/api/templates/${template.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao atualizar template");
      toast.success(okMsg);
      if (typeof body.status === "string") setStatus(body.status);
      if (typeof body.isDefault === "boolean") setIsDefault(body.isDefault);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao atualizar");
    } finally {
      setActivating(false);
    }
  }

  async function activate() {
    const missing = validation?.missingRequired ?? [];
    if (missing.length > 0) {
      // AlertDialog (não window.confirm — dialog nativo bloqueia automação
      // e destoa da UI).
      setConfirmOpen(true);
      return;
    }
    await patchTemplate({ status: "active" }, "Template ativado.");
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ativar com campos obrigatórios ausentes?</AlertDialogTitle>
            <AlertDialogDescription>
              Os tokens{" "}
              <code className="rounded bg-muted px-1">
                {(validation?.missingRequired ?? []).map((t) => `{{${t}}}`).join(", ")}
              </code>{" "}
              não estão no documento — esses campos não serão preenchidos nos
              contratos gerados até você inseri-los no modelo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar e revisar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                void patchTemplate({ status: "active" }, "Template ativado.");
              }}
            >
              Ativar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="min-h-[70vh] overflow-hidden rounded-lg border">
        <iframe
          src={template.embedLink}
          className="h-full min-h-[70vh] w-full"
          title="Modelo da imobiliária"
        />
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span>Status</span>
              <span className="flex items-center gap-1.5">
                <Badge variant={status === "active" ? "default" : "outline"}>
                  {status === "active" ? "Ativo" : status === "draft" ? "Rascunho" : status}
                </Badge>
                {isDefault && (
                  <Badge variant="outline" className="border-amber-300 text-amber-700">
                    Padrão
                  </Badge>
                )}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={revalidate} disabled={validating}>
                {validating ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                )}
                Revalidar
              </Button>
              {status !== "active" && (
                <Button size="sm" onClick={activate} disabled={activating || !validation}>
                  Ativar template
                </Button>
              )}
              {status === "active" && !isDefault && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    patchTemplate(
                      { isDefault: true },
                      "Definido como padrão da modalidade."
                    )
                  }
                  disabled={activating}
                >
                  <Star className="mr-1.5 h-3.5 w-3.5" />
                  Definir como padrão
                </Button>
              )}
            </div>
            {validation && validation.missingRequired.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Obrigatórios ausentes:{" "}
                  {validation.missingRequired.map((t) => `{{${t}}}`).join(", ")}
                </span>
              </div>
            )}
            {validation && validation.unknown.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-900">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Tokens desconhecidos (não serão preenchidos):{" "}
                  {validation.unknown.map((t) => `{{${t}}}`).join(", ")}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Catálogo de campos</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="max-h-[48vh] space-y-1.5 overflow-y-auto pr-1 text-xs">
              {(validation?.catalog ?? []).map((c) => (
                <li key={c.token} className="flex items-start gap-2">
                  {c.present ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
                  ) : (
                    <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                  )}
                  <div>
                    <code className="rounded bg-muted px-1 py-0.5">
                      {"{{"}{c.token}{"}}"}
                    </code>
                    {c.required && (
                      <span className="ml-1 text-amber-700">obrigatório</span>
                    )}
                    {c.kind === "composed" && (
                      <span className="ml-1 text-muted-foreground">(bloco)</span>
                    )}
                    <p className="text-muted-foreground">{c.label}</p>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
