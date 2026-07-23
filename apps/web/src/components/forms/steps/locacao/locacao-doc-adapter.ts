import type { SelectGroup } from "@/components/forms/NativeSelect";
import type { DocumentCardData } from "@/components/forms/DocumentCard";
import type { DocumentKind } from "@/lib/forms/extracted-to-form";
import {
  mapExtractedToLocacaoForm,
  suggestLocacaoAssignment,
  type LocacaoFormSnapshot,
} from "@/lib/forms/extracted-to-form-locacao";
import type { DocumentosStepAdapter } from "@/components/forms/steps/doc-step-adapter";

/**
 * Adapter da etapa 0 pro form de LOCAÇÃO (dadosLocacaoSchema): slots
 * Locadores/Locatários/Fiador/Representantes/Imóvel (singular). O fiador só
 * aparece quando a garantia escolhida é fiador; o imóvel não tem "+ Novo"
 * (locação trata UM imóvel por contrato).
 */

const KIND_LABELS: Partial<Record<DocumentKind, string>> = {
  locador: "Locador",
  locatario: "Locatário",
  fiador: "Fiador",
  imovel: "Imóvel",
};

function nameOf(p: Record<string, unknown> | undefined): string | null {
  const nome = (p?.nome ?? p?.razao_social) as string | undefined;
  return typeof nome === "string" && nome.trim() ? nome.trim() : null;
}

function buildLocacaoOptions(
  rawSnapshot: Record<string, unknown>,
  docs: DocumentCardData[]
): SelectGroup[] {
  const snapshot = rawSnapshot as LocacaoFormSnapshot;
  const maxAssigned = (kind: DocumentKind) =>
    docs.reduce(
      (m, d) => (d.assignment.kind === kind ? Math.max(m, d.assignment.index) : m),
      -1
    );

  const buildPartyOptions = (
    kind: "locador" | "locatario",
    list: Array<Record<string, unknown>> | undefined,
    singular: string
  ) => {
    const count = Math.max(1, list?.length ?? 1, maxAssigned(kind) + 1);
    const opts: Array<{ value: string; label: string }> = [];
    for (let i = 0; i < count; i++) {
      const name = nameOf(list?.[i]);
      const ord = `${singular} ${i + 1}`;
      opts.push({ value: `${kind}:${i}`, label: name ? `${ord} — ${name}` : ord });
    }
    opts.push({ value: `${kind}:new`, label: `+ Novo ${singular.toLowerCase()}` });
    return opts;
  };

  const groups: SelectGroup[] = [
    { label: "Locadores", options: buildPartyOptions("locador", snapshot.locadores, "Locador") },
    { label: "Locatários", options: buildPartyOptions("locatario", snapshot.locatarios, "Locatário") },
  ];

  // Fiador: só quando a garantia é por fiador (ou já há doc atribuído a ele).
  if (snapshot.garantia?.tipo === "fiador" || maxAssigned("fiador") >= 0) {
    const fiadorName = nameOf(snapshot.garantia?.fiador);
    groups.push({
      label: "Fiador",
      options: [
        { value: "fiador:0", label: fiadorName ? `Fiador — ${fiadorName}` : "Fiador" },
      ],
    });
  }

  // Representantes: só pra partes PJ já cadastradas.
  const repOptions: Array<{ value: string; label: string }> = [];
  const pushReps = (
    kind: "representante_locador" | "representante_locatario",
    list: Array<Record<string, unknown>> | undefined,
    parentLabel: string
  ) => {
    if (!Array.isArray(list)) return;
    for (let i = 0; i < list.length; i++) {
      if (list[i]?.tipo_pessoa !== "juridica") continue;
      const razao = nameOf(list[i]);
      const base = `Representante de ${parentLabel} ${i + 1}`;
      repOptions.push({
        value: `${kind}:${i}`,
        label: razao ? `${base} — ${razao}` : base,
      });
    }
  };
  pushReps("representante_locador", snapshot.locadores, "Locador");
  pushReps("representante_locatario", snapshot.locatarios, "Locatário");
  if (repOptions.length > 0) {
    groups.push({ label: "Representantes legais", options: repOptions });
  }

  groups.push({ label: "Imóvel", options: [{ value: "imovel:0", label: "Imóvel" }] });
  groups.push({
    label: "Outros",
    options: [{ value: "outro:0", label: "Outros (sem aplicar)" }],
  });

  return groups;
}

export const locacaoDocAdapter: DocumentosStepAdapter = {
  suggest: (category, fields, snapshot, siblings = []) =>
    suggestLocacaoAssignment(category, fields, snapshot as LocacaoFormSnapshot, siblings),
  apply: (extraction, assignment, form, options) =>
    mapExtractedToLocacaoForm(extraction, assignment, form, options),
  buildOptions: buildLocacaoOptions,
  fieldKeyForKind(kind) {
    if (kind === "locador" || kind === "representante_locador") {
      return { key: "locadores", emptyItem: { tipo_pessoa: "fisica" } };
    }
    if (kind === "locatario" || kind === "representante_locatario") {
      return { key: "locatarios", emptyItem: { tipo_pessoa: "fisica" } };
    }
    // fiador (subobjeto de garantia) e imovel (objeto singular) não são
    // arrays — RHF cria o path no primeiro setValue.
    return null;
  },
  kindLabel: (kind) => KIND_LABELS[kind] ?? kind,
  topKeyForKind(kind) {
    switch (kind) {
      case "locador":
      case "representante_locador":
        return "locadores";
      case "locatario":
      case "representante_locatario":
        return "locatarios";
      // Singular no schema de locação; casa com ROLE_PATHS.locador = [..,"imovel"].
      case "imovel":
        return "imovel";
      // Fiador qualifica-se dentro de `garantia` (ROLE_PATHS.fiador = ["garantia"]).
      case "fiador":
        return "garantia";
      default:
        return null;
    }
  },
  // Sem applyFicha: ficha-resumo declara papéis de venda; em locação cai em "outro".
};
