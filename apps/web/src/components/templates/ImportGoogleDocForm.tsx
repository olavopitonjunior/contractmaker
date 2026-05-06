"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Loader2, Save } from "lucide-react";

interface ValidateResponse {
  ok: true;
  docId: string;
  name: string;
  mimeType: string;
  placeholdersFound: string[];
  warnings: string[];
}

export function ImportGoogleDocForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState<ValidateResponse | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [modalidade, setModalidade] = useState<"a_vista" | "financiamento">(
    "a_vista"
  );
  const [isDefault, setIsDefault] = useState(false);

  async function handleValidate() {
    if (!url.trim()) {
      toast.error("Cole a URL ou ID do Google Doc.");
      return;
    }
    setValidating(true);
    setValidation(null);
    try {
      const res = await fetch("/api/templates/validate-gdoc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Falha ao validar Google Doc.");
        return;
      }
      setValidation(data);
      if (!name) setName(data.name);
      toast.success("Google Doc validado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro de conexão.");
    } finally {
      setValidating(false);
    }
  }

  async function handleSave() {
    if (!validation) {
      toast.error("Valide o Google Doc primeiro.");
      return;
    }
    if (!name.trim()) {
      toast.error("Defina um nome pro template.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          handlebarsSource: `<!-- Template Google Doc: ${validation.docId} -->`,
          modalidade,
          isDefault,
          engine: "google_docs",
          googleTemplateDocId: validation.docId,
          version: "1.0.0",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Falha ao criar template.");
        return;
      }
      toast.success("Template criado!");
      router.push("/templates");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0 text-amber-700 dark:text-amber-400" />
          <div className="space-y-1">
            <p className="font-medium text-amber-900 dark:text-amber-200">
              Limitações de templates Google Doc
            </p>
            <p className="text-amber-900/90 dark:text-amber-200/90">
              Templates criados a partir de um Google Doc existente NÃO suportam
              loops <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/50">{"{{#each}}"}</code>{" "}
              nem condicionais{" "}
              <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/50">{"{{#if}}"}</code>.
              São melhores pra contratos simples (1 vendedor, 1 comprador, 1 imóvel).
              Para múltiplas partes, use template Handlebars.
            </p>
            <p className="text-amber-900/90 dark:text-amber-200/90">
              Tokens aceitos no doc:{" "}
              <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/50">{"{{vendedor_nome}}"}</code>,{" "}
              <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/50">{"{{imovel_endereco}}"}</code>,{" "}
              <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/50">{"{{pagamento_valor_total}}"}</code>.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="gdoc-url">URL ou ID do Google Doc</Label>
        <div className="flex gap-2">
          <Input
            id="gdoc-url"
            placeholder="https://docs.google.com/document/d/.../edit"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleValidate}
            disabled={validating}
          >
            {validating ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mr-1" />
            )}
            Validar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          O doc precisa estar compartilhado com a service account com permissão
          de leitor (no mínimo).
        </p>
      </div>

      {validation && (
        <div className="space-y-3 rounded-md border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              {validation.name}
            </p>
            <Badge variant="outline" className="text-xs">
              {validation.docId.slice(0, 12)}…
            </Badge>
          </div>

          {validation.placeholdersFound.length > 0 ? (
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">
                Placeholders encontrados ({validation.placeholdersFound.length}):
              </p>
              <div className="flex flex-wrap gap-1">
                {validation.placeholdersFound.map((p) => (
                  <Badge key={p} variant="secondary" className="text-xs font-mono">
                    {p}
                  </Badge>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Nenhum placeholder <code>{"{{token}}"}</code> encontrado no doc.
              O contrato gerado será uma cópia exata.
            </p>
          )}

          {validation.warnings.length > 0 && (
            <div className="space-y-1 rounded bg-amber-50 dark:bg-amber-950/30 p-2 text-xs">
              {validation.warnings.map((w, i) => (
                <div key={i} className="flex gap-1.5 text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="tpl-name">Nome do template</Label>
          <Input
            id="tpl-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: CCV Simples Apartamento"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tpl-modalidade">Modalidade</Label>
          <Select
            value={modalidade}
            onValueChange={(v) => setModalidade(v as typeof modalidade)}
          >
            <SelectTrigger id="tpl-modalidade">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="a_vista">À Vista</SelectItem>
              <SelectItem value="financiamento">Financiamento</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="tpl-desc">Descrição (opcional)</Label>
        <Input
          id="tpl-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Quando usar este template"
        />
      </div>

      <div className="flex items-center gap-3">
        <Switch
          id="isDefault"
          checked={isDefault}
          onCheckedChange={setIsDefault}
        />
        <Label htmlFor="isDefault" className="text-sm">
          Tornar padrão para {modalidade === "financiamento" ? "Financiamento" : "À Vista"}
        </Label>
      </div>

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving || !validation}>
          <Save className="h-4 w-4 mr-1" />
          {saving ? "Criando..." : "Criar Template"}
        </Button>
      </div>
    </div>
  );
}
