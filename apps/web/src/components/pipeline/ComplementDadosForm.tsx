"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

interface MissingFieldDef {
  path: string;
  label: string;
  type: string;
  placeholder?: string;
}

interface Props {
  missingFields: MissingFieldDef[];
  onSubmit: (fields: Record<string, string | number | null>) => Promise<void>;
  onCancel: () => void;
}

/**
 * Inline form that expands inside a skipped CertidaoJob card. Asks only for
 * the specific missing fields (data_nascimento, sql, inscricao_municipal, ...),
 * submits to /api/deals/:id/certidoes/:jobId/complete.
 */
export function ComplementDadosForm({
  missingFields,
  onSubmit,
  onCancel,
}: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const fields: Record<string, string | number | null> = {};
    for (const mf of missingFields) {
      const v = values[mf.path];
      if (!v || v.trim() === "") {
        return;
      }
      fields[mf.path] = mf.type === "number" ? Number(v) : v.trim();
    }
    setSubmitting(true);
    try {
      await onSubmit(fields);
    } finally {
      setSubmitting(false);
    }
  };

  const allFilled = missingFields.every(
    (mf) => values[mf.path] && values[mf.path].trim() !== ""
  );

  return (
    <div className="ml-6 rounded border border-muted bg-muted/10 p-3 space-y-3">
      <p className="text-xs text-muted-foreground">
        Preencha os dados abaixo para desbloquear esta certidão.
      </p>
      {missingFields.map((mf) => (
        <div key={mf.path} className="space-y-1">
          <Label className="text-xs">{mf.label}</Label>
          <Input
            type={mf.type === "date" ? "date" : mf.type === "number" ? "number" : "text"}
            placeholder={mf.placeholder}
            value={values[mf.path] ?? ""}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, [mf.path]: e.target.value }))
            }
            className="h-8 text-sm"
          />
        </div>
      ))}
      <div className="flex gap-2 justify-end pt-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancelar
        </Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!allFilled || submitting}
        >
          {submitting ? (
            <>
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              Consultando…
            </>
          ) : (
            "Consultar certidão"
          )}
        </Button>
      </div>
    </div>
  );
}
