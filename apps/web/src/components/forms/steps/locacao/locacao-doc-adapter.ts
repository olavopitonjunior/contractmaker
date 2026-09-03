import type { SelectGroup } from "@/components/forms/NativeSelect";
import type { DocumentCardData } from "@/components/forms/DocumentCard";
import type { DocumentKind } from "@/lib/forms/extracted-to-form";
import {
  applyFichaResumoLocacao,
  mapExtractedToLocacaoForm,
  suggestLocacaoAssignment,
  type LocacaoFormSnapshot,
} from "@/lib/forms/extracted-to-form-locacao";
import type { DocumentosStepAdapter } from "@/components/forms/steps/doc-step-adapter";
import { applyFiadorFlip, FIADOR_FLIP_TOAST } from "@/lib/forms/garantia-fiador-flip";

/**
 * Adapter da etapa 0 pro form de LOCAÇÃO (dadosLocacaoSchema): slots
 * Locadores/Locatários/Fiador/Representantes/Imóvel (singular). Fiador e
 * cônjuge do fiador aparecem SEMPRE (2026-09-02): a etapa Documentos vem antes
 * da etapa Garantia, então condicionar o grupo a `garantia.tipo === "fiador"`
 * o escondia justamente num formulário novo. Atribuir um doc a eles é o que
 * define a modalidade (`onAssign`). O imóvel não tem "+ Novo" (locação trata UM
 * imóvel por contrato).
 */

const KIND_LABELS: Partial<Record<DocumentKind, string>> = {
  locador: "Locador",
  locatario: "Locatário",
  fiador: "Fiador",
  imovel: "Imóvel",
  conjuge_locador: "Cônjuge do locador",
  conjuge_locatario: "Cônjuge do locatário",
  conjuge_fiador: "Cônjuge do fiador",
  representante_locador: "Representante do locador",
  representante_locatario: "Representante do locatário",
};

function nameOf(p: Record<string, unknown> | undefined): string | null {
  const nome = (p?.nome ?? p?.razao_social) as string | undefined;
  return typeof nome === "string" && nome.trim() ? nome.trim() : null;
}

export function buildLocacaoOptions(
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
    // Doc atribuído a um sub-slot (cônjuge/representante) de índice alto também
    // implica a existência da parte pai — espelha o vCount/cCount da venda.
    const count = Math.max(
      1,
      list?.length ?? 1,
      maxAssigned(kind) + 1,
      maxAssigned(`conjuge_${kind}` as DocumentKind) + 1,
      maxAssigned(`representante_${kind}` as DocumentKind) + 1
    );
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

  // Fiador: sempre disponível (ver cabeçalho). O nome entra no rótulo quando a
  // etapa 5 já o tem. Os links por papel que não têm `garantia` no escopo
  // (locador) perdem o grupo em `filterAssignmentOptionsByScope`, coerente com
  // o 403 do servidor.
  const fiadorName = nameOf(snapshot.garantia?.fiador);
  groups.push({
    label: "Fiador",
    options: [
      { value: "fiador:0", label: fiadorName ? `Fiador — ${fiadorName}` : "Fiador" },
    ],
  });

  // Cônjuges: oferecidos pra todo pai que não é PJ. NÃO exigimos
  // `estado_civil === "Casado(a)"` — a etapa 0 vem ANTES das etapas de parte,
  // então o estado civil ainda está vazio e o grupo sumiria justo quando é
  // preciso. Sub-slot não tem "+ Novo" (deriva do pai).
  const conjugeOptions: Array<{ value: string; label: string }> = [];
  const pushConjuges = (
    kind: "conjuge_locador" | "conjuge_locatario",
    parentKind: "locador" | "locatario",
    list: Array<Record<string, unknown>> | undefined,
    parentLabel: string
  ) => {
    const count = Math.max(
      1,
      list?.length ?? 1,
      maxAssigned(parentKind) + 1,
      maxAssigned(kind) + 1
    );
    for (let i = 0; i < count; i++) {
      const parent = list?.[i];
      if (parent?.tipo_pessoa === "juridica") continue;
      const parentName = nameOf(parent);
      const base = `Cônjuge de ${parentLabel} ${i + 1}`;
      conjugeOptions.push({
        value: `${kind}:${i}`,
        label: parentName ? `${base} — ${parentName}` : base,
      });
    }
  };
  pushConjuges("conjuge_locador", "locador", snapshot.locadores, "Locador");
  pushConjuges("conjuge_locatario", "locatario", snapshot.locatarios, "Locatário");
  // Fiador PJ (fiança comercial) não tem cônjuge — mesmo guard dos demais pais.
  if (snapshot.garantia?.fiador?.tipo_pessoa !== "juridica") {
    conjugeOptions.push({
      value: "conjuge_fiador:0",
      label: fiadorName ? `Cônjuge do fiador — ${fiadorName}` : "Cônjuge do fiador",
    });
  }
  if (conjugeOptions.length > 0) {
    groups.push({ label: "Cônjuges", options: conjugeOptions });
  }

  // Representantes: TODOS os pais, não só os já marcados como PJ.
  //
  // O gate `tipo_pessoa === "juridica"` escondia o grupo inteiro: a etapa 0 vem
  // ANTES das etapas de parte, então `tipo_pessoa` ainda é o default "fisica" e
  // o usuário nunca via onde atribuir a procuração/contrato social — o
  // documento ia pra "outro" e o gate H.5 travava o "Aplicar aos campos". A
  // venda removeu esse mesmo gate (ver buildSubKindOptions em
  // build-assignment-options.ts); uma chave `.representante` num PF é inócua.
  const repOptions: Array<{ value: string; label: string }> = [];
  const pushReps = (
    kind: "representante_locador" | "representante_locatario",
    list: Array<Record<string, unknown>> | undefined,
    parentLabel: string
  ) => {
    if (!Array.isArray(list)) return;
    for (let i = 0; i < list.length; i++) {
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
    if (
      kind === "locador" ||
      kind === "representante_locador" ||
      kind === "conjuge_locador"
    ) {
      return { key: "locadores", emptyItem: { tipo_pessoa: "fisica" } };
    }
    if (
      kind === "locatario" ||
      kind === "representante_locatario" ||
      kind === "conjuge_locatario"
    ) {
      return { key: "locatarios", emptyItem: { tipo_pessoa: "fisica" } };
    }
    // fiador + cônjuge do fiador (subobjetos de garantia) e imovel (objeto
    // singular) não são arrays — RHF cria o path no primeiro setValue.
    return null;
  },
  kindLabel: (kind) => KIND_LABELS[kind] ?? kind,
  // `garantia` entra porque o fiador (e o cônjuge dele) se qualificam lá dentro.
  partyListKeys: ["locadores", "locatarios", "garantia"],
  // Doc no fiador/cônjuge do fiador ⇒ a garantia é fiança. `shouldDirty` é o
  // que põe `garantia` no escopo sujo do auto-save; `shouldTouch` faz a etapa 5
  // já abrir com o select em "Fiador". Idempotente e sem reversão: reatribuir o
  // doc para outra parte NÃO volta o tipo (pode haver outros docs no fiador,
  // o tipo pode ter sido manual, e "voltar para quê" seria chute).
  onAssign(kind, _index, form) {
    const flipped = applyFiadorFlip(
      kind,
      (path) => form.getValues(path as never) as unknown,
      (path, value) =>
        form.setValue(path as never, value as never, {
          shouldDirty: true,
          shouldTouch: true,
        })
    );
    return flipped ? FIADOR_FLIP_TOAST : null;
  },
  topKeyForKind(kind) {
    switch (kind) {
      case "locador":
      case "representante_locador":
      case "conjuge_locador":
        return "locadores";
      case "locatario":
      case "representante_locatario":
      case "conjuge_locatario":
        return "locatarios";
      // Singular no schema de locação; casa com ROLE_PATHS.locador = [..,"imovel"].
      case "imovel":
        return "imovel";
      // Fiador (e o cônjuge dele) qualificam-se dentro de `garantia`
      // (ROLE_PATHS.fiador = ["garantia"]).
      case "fiador":
      case "conjuge_fiador":
        return "garantia";
      default:
        return null;
    }
  },
  applyFicha: (data, form, options) =>
    applyFichaResumoLocacao(data, form, options),
};
