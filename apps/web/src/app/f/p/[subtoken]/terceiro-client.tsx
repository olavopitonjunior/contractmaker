"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/layout/brand-mark";
import {
  TerceiroStep,
  formatErrorForType,
} from "@/components/forms/steps/TerceiroStep";
import {
  TERCEIRO_DATA_KEY,
  type CategoryFieldDef,
} from "@/lib/forms/participant-category";

interface TerceiroCategoryView {
  slug: string;
  label: string;
  description: string | null;
  fields: CategoryFieldDef[];
}

interface TerceiroFormClientProps {
  subtoken: string;
  category: TerceiroCategoryView;
  /** Slot desta pessoa dentro de `terceiros.<slug>[]`. */
  partyIndex: number;
  /** Já filtrado pelo servidor — só `terceiros.<slug>`. */
  initialData: Record<string, unknown>;
  formTitle: string | null;
  completedAt: string | null;
  locked?: boolean;
}

/**
 * Tela do link de TERCEIRO. Um passo só: os campos que a imobiliária declarou
 * na categoria, com máscara/validação de formato compartilhadas com o resto do
 * formulário, e o mesmo "concluir parte" (`markCompleted`) dos papéis nativos.
 *
 * Não reusa `SalesFormWizard`/`LocacaoFormWizard` de propósito: aqueles wizards
 * são a máquina de steps do `DadosContrato` (PF/PJ, cônjuge, OCR, certidões,
 * obrigatoriedade por preset). Nada disso existe numa categoria configurável —
 * e enfiar um step sintético na numeração deles mudaria o comportamento dos 5
 * papéis nativos, que é justamente o que não pode acontecer.
 */
export function TerceiroFormClient({
  subtoken,
  category,
  partyIndex,
  initialData,
  formTitle,
  completedAt,
  locked,
}: TerceiroFormClientProps) {
  const initialValues = useMemo(() => {
    const branch = (initialData?.[TERCEIRO_DATA_KEY] ?? {}) as Record<
      string,
      unknown
    >;
    const list = branch?.[category.slug];
    const entry = Array.isArray(list) ? list[partyIndex] : undefined;
    return entry && typeof entry === "object"
      ? ({ ...entry } as Record<string, unknown>)
      : {};
  }, [initialData, category.slug, partyIndex]);

  const [values, setValues] = useState<Record<string, unknown>>(initialValues);
  const [missingKeys, setMissingKeys] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(Boolean(completedAt));

  const readOnly = Boolean(locked);

  function setField(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setMissingKeys((prev) => prev.filter((k) => k !== key));
  }

  /**
   * Monta o payload no NAMESPACE da categoria. O array preserva os slots
   * anteriores (outra pessoa da mesma categoria) — o servidor ainda recorta o
   * payload por `terceiros.<slug>`, mas mandar o array inteiro evita que o
   * merge (arrays substituem inteiros) encurte a lista.
   */
  function buildPayload(): Record<string, unknown> {
    const branch = (initialData?.[TERCEIRO_DATA_KEY] ?? {}) as Record<
      string,
      unknown
    >;
    const current = Array.isArray(branch?.[category.slug])
      ? [...(branch[category.slug] as unknown[])]
      : [];
    while (current.length <= partyIndex) current.push({});
    current[partyIndex] = values;
    return { [TERCEIRO_DATA_KEY]: { [category.slug]: current } };
  }

  async function save(markCompleted: boolean) {
    if (readOnly) return;

    if (markCompleted) {
      // Pré-checagem local (o servidor repete e é quem manda — 422).
      const missing = category.fields
        .filter((f) => f.required)
        .filter((f) => String(values[f.key] ?? "").trim() === "")
        .map((f) => f.key);
      const badFormat = category.fields.find(
        (f) => formatErrorForType(f.type, values[f.key]) !== null,
      );
      if (missing.length > 0) {
        setMissingKeys(missing);
        toast.error("Preencha os campos obrigatórios antes de concluir");
        return;
      }
      if (badFormat) {
        toast.error(`Confira o campo "${badFormat.label}"`);
        return;
      }
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/forms/participant/${subtoken}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataJson: buildPayload(), markCompleted }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 422 && Array.isArray(data.missingRequired)) {
          // Paths vêm completos (`terceiros.<slug>.<idx>.<key>`) — a tela
          // destaca pela última parte.
          setMissingKeys(
            data.missingRequired.map((p: string) => p.split(".").pop() ?? p),
          );
        }
        toast.error(data.error || "Não foi possível salvar");
        return;
      }
      if (markCompleted) {
        setDone(true);
        toast.success("Dados enviados! A imobiliária já recebeu.");
      } else {
        toast.success("Rascunho salvo");
      }
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-card px-6 py-4 shrink-0">
        <div className="mx-auto max-w-4xl flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <BrandMark className="h-8 w-8 text-primary" />
            <div>
              <h1 className="font-display text-lg font-semibold tracking-tight leading-tight">
                Preencha seus dados como {category.label}
              </h1>
              {formTitle && (
                <p className="text-xs text-muted-foreground leading-tight">
                  {formTitle}
                </p>
              )}
            </div>
          </div>
          <span className="text-xs rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
            Link exclusivo — {category.label.toLowerCase()}
          </span>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-4xl p-6 pb-16 space-y-4">
        {done ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-center dark:border-green-900 dark:bg-green-950/40">
            <p className="text-base font-medium text-green-800 dark:text-green-200">
              Seus dados já foram salvos!
            </p>
            <p className="text-sm text-green-700/80 dark:text-green-300/80 mt-1">
              A imobiliária recebeu suas informações. Você pode revisar/editar
              se precisar.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
            Este link mostra apenas os campos que pertencem a você como{" "}
            <strong>{category.label.toLowerCase()}</strong>. As demais partes do
            negócio receberam links separados e não veem seus dados.
          </div>
        )}

        {category.description && (
          <p className="text-sm text-muted-foreground">{category.description}</p>
        )}

        <div className="rounded-lg border p-4">
          <TerceiroStep
            fields={category.fields}
            values={values}
            onChange={setField}
            missingKeys={missingKeys}
            disabled={readOnly || busy}
          />
        </div>

        {readOnly ? (
          <p className="text-sm text-muted-foreground">
            Este formulário foi travado pela imobiliária e não aceita mais
            alterações.
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <Button onClick={() => save(true)} disabled={busy}>
              {busy ? "Salvando…" : done ? "Salvar alterações" : "Concluir e enviar"}
            </Button>
            <Button
              variant="outline"
              onClick={() => save(false)}
              disabled={busy}
            >
              Salvar rascunho
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
