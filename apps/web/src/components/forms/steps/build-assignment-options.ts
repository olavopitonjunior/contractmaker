import type { SelectGroup } from "@/components/forms/NativeSelect";
import type { DocumentCardData } from "@/components/forms/DocumentCard";
import type { DocumentKind } from "@/lib/forms/extracted-to-form";

/**
 * Construção das opções do seletor "Atribuir a…" da esteira de VENDA.
 *
 * Módulo puro (sem hooks/React) porque as MESMAS opções são usadas em dois
 * lugares: a etapa 0 do formulário público (`DocumentosStep`) e a aba
 * Documentos do deal no admin (`DealDetail`), que antes tinha um seletor
 * hardcoded só com vendedor/comprador/imóvel/outro.
 */

export interface FormSlotData {
  vendedores?: Array<Record<string, unknown> | undefined>;
  compradores?: Array<Record<string, unknown> | undefined>;
  imoveis?: Array<Record<string, unknown> | undefined>;
}

/** Kinds que ganham a opção "+ Novo …" (os que têm array próprio no form). */
export const PARENT_KINDS = new Set<DocumentKind>([
  "vendedor",
  "comprador",
  "imovel",
]);

export function slotName(
  kind: DocumentKind,
  index: number,
  snapshot: FormSlotData,
  docs: DocumentCardData[]
): string | null {
  // 1. Form-typed name takes precedence
  const list =
    kind === "vendedor"
      ? snapshot.vendedores
      : kind === "comprador"
      ? snapshot.compradores
      : kind === "imovel"
      ? snapshot.imoveis
      : null;
  const slot = list?.[index];
  if (slot) {
    if (kind === "imovel") {
      const rua = slot.rua as string | undefined;
      const numero = slot.numero as string | undefined;
      if (rua) return numero ? `${rua}, ${numero}` : rua;
    } else {
      const nome = (slot.nome || slot.razao_social) as string | undefined;
      if (nome && nome.trim()) return nome.trim();
    }
  }
  // 2. Fall back to a doc already assigned to this slot with extracted name
  const docInSlot = docs.find(
    (d) =>
      d.assignment.kind === kind &&
      d.assignment.index === index &&
      d.fields &&
      d.status === "ready"
  );
  if (docInSlot?.fields) {
    if (kind === "imovel") {
      const rua = docInSlot.fields.endereco_completo || docInSlot.fields.endereco;
      if (typeof rua === "string" && rua.trim()) return rua.trim().slice(0, 40);
    } else {
      const nome = docInSlot.fields.nome_completo || docInSlot.fields.titular_nome;
      if (typeof nome === "string" && nome.trim()) return nome.trim();
    }
  }
  return null;
}

type SubKind =
  | "conjuge_vendedor"
  | "conjuge_comprador"
  | "representante_vendedor"
  | "representante_comprador"
  | "procurador_vendedor"
  | "procurador_comprador";

type SubSlot = "conjuge" | "representante" | "procurador";

/**
 * Cônjuges, representantes e procuradores derivam da parte pai.
 *
 * Os gates antigos (cônjuge só pra parte casada, representante só pra PJ)
 * escondiam os grupos INTEIROS na etapa 0: ela vem ANTES das etapas de parte,
 * então `estado_civil` está vazio e `tipo_pessoa` é "fisica" por default — o
 * usuário nunca via onde colocar a certidão do cônjuge ou a procuração e o
 * gate H.5 travava o "Aplicar aos campos". Hoje:
 *
 * - cônjuge e procurador: todo pai que não é PJ (o subobjeto só existe em PF)
 * - representante: TODOS os pais (a parte pode virar PJ nas etapas seguintes;
 *   uma chave `.representante` num PF é inofensiva)
 *
 * Nunca há "+ Novo" aqui — o sub-slot deriva do índice do pai.
 */
export function buildSubKindOptions(
  kind: SubKind,
  parentList: Array<Record<string, unknown> | undefined> | undefined,
  parentLabel: string,
  sub: SubSlot,
  count: number
): Array<{ value: string; label: string }> {
  const opts: Array<{ value: string; label: string }> = [];
  for (let i = 0; i < count; i++) {
    const parent = parentList?.[i];
    if (sub !== "representante" && parent?.tipo_pessoa === "juridica") continue;
    const parentName = (parent?.razao_social ?? parent?.nome) as
      | string
      | undefined;
    const prefix =
      sub === "conjuge"
        ? "Cônjuge"
        : sub === "procurador"
        ? "Procurador"
        : "Representante";
    const baseLabel = `${prefix} de ${parentLabel} ${i + 1}`;
    opts.push({
      value: `${kind}:${i}`,
      label:
        parentName && parentName.trim()
          ? `${baseLabel} — ${parentName.trim()}`
          : baseLabel,
    });
  }
  return opts;
}

export function buildAssignmentOptions(
  snapshot: FormSlotData,
  docs: DocumentCardData[]
): SelectGroup[] {
  // Compute the visible count for each kind: max of (form snapshot length,
  // highest index any doc is assigned to + 1, default 1)
  const maxAssigned = (...kinds: DocumentKind[]) =>
    docs.reduce(
      (m, d) =>
        kinds.includes(d.assignment.kind) ? Math.max(m, d.assignment.index) : m,
      -1
    );
  const vCount = Math.max(
    1,
    snapshot.vendedores?.length ?? 1,
    maxAssigned(
      "vendedor",
      "conjuge_vendedor",
      "representante_vendedor",
      "procurador_vendedor"
    ) + 1
  );
  const cCount = Math.max(
    1,
    snapshot.compradores?.length ?? 1,
    maxAssigned(
      "comprador",
      "conjuge_comprador",
      "representante_comprador",
      "procurador_comprador"
    ) + 1
  );
  const iCount = Math.max(
    1,
    snapshot.imoveis?.length ?? 1,
    maxAssigned("imovel") + 1
  );

  const buildKindOptions = (
    kind: DocumentKind,
    count: number,
    singularLabel: string
  ) => {
    const opts: Array<{ value: string; label: string }> = [];
    for (let i = 0; i < count; i++) {
      const name = slotName(kind, i, snapshot, docs);
      const ord = `${singularLabel} ${i + 1}`;
      opts.push({
        value: `${kind}:${i}`,
        label: name ? `${ord} — ${name}` : ord,
      });
    }
    if (PARENT_KINDS.has(kind)) {
      opts.push({
        value: `${kind}:new`,
        label: `+ Novo ${singularLabel.toLowerCase()}`,
      });
    }
    return opts;
  };

  const groups: SelectGroup[] = [
    {
      label: "Vendedores",
      options: buildKindOptions("vendedor", vCount, "Vendedor"),
    },
    {
      label: "Compradores",
      options: buildKindOptions("comprador", cCount, "Comprador"),
    },
  ];

  const conjugeOptions = [
    ...buildSubKindOptions(
      "conjuge_vendedor",
      snapshot.vendedores,
      "Vendedor",
      "conjuge",
      vCount
    ),
    ...buildSubKindOptions(
      "conjuge_comprador",
      snapshot.compradores,
      "Comprador",
      "conjuge",
      cCount
    ),
  ];
  if (conjugeOptions.length > 0) {
    groups.push({ label: "Cônjuges", options: conjugeOptions });
  }

  const procuradorOptions = [
    ...buildSubKindOptions(
      "procurador_vendedor",
      snapshot.vendedores,
      "Vendedor",
      "procurador",
      vCount
    ),
    ...buildSubKindOptions(
      "procurador_comprador",
      snapshot.compradores,
      "Comprador",
      "procurador",
      cCount
    ),
  ];
  if (procuradorOptions.length > 0) {
    groups.push({ label: "Procuradores", options: procuradorOptions });
  }

  const representanteOptions = [
    ...buildSubKindOptions(
      "representante_vendedor",
      snapshot.vendedores,
      "Vendedor",
      "representante",
      vCount
    ),
    ...buildSubKindOptions(
      "representante_comprador",
      snapshot.compradores,
      "Comprador",
      "representante",
      cCount
    ),
  ];
  if (representanteOptions.length > 0) {
    groups.push({ label: "Representantes legais", options: representanteOptions });
  }

  groups.push({
    label: "Imóveis",
    options: buildKindOptions("imovel", iCount, "Imóvel"),
  });
  groups.push({
    label: "Outros",
    options: [{ value: "outro:0", label: "Outros (sem aplicar)" }],
  });

  return groups;
}
