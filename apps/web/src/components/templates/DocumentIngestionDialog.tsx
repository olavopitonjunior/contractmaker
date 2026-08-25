"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  FileText,
  FileUp,
  Layers,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import {
  GARANTIA_LABELS,
  GARANTIA_TIPOS,
  PESSOA_LABELS,
  modalidadeLabel,
  normalizeGarantiaTipo,
  type GarantiaTipo,
} from "@/lib/contracts/template-category";
import {
  INGEST_DOC_TYPE_DEFS,
  ingestDocTypeDef,
  modalidadeForIngest,
  type CriteriaField,
  type IngestDocType,
  type IngestDocTypeDef,
} from "@/lib/templates/ingestion-types";
import {
  buildConsolidationPlan,
  buildDifferenceMatrix,
  groupSimilarDocs,
  normalizeDoc,
  primaryDifferenceRow,
  suggestGarantiaTipo,
  type ConsolidationGroup,
  type ConsolidationPlan,
  type DifferenceRow,
} from "@/lib/templates/consolidation";
import {
  collidingVariantValues,
  consolidatedMatchCriteria,
  garantiaSlotCandidate,
  guessDocumentGarantia,
  ingestionFamilyKey,
  parseSlotReports,
  slotFailureMessage,
  suggestProviderName,
  type SlotBlockCandidate,
} from "@/lib/templates/ingestion-triage";

// ────────────────────────────────────────────────────────────────────────────
// Estado
// ────────────────────────────────────────────────────────────────────────────

type EntryStatus =
  | "pending"
  | "analyzing"
  | "ready"
  | "analysis_error"
  | "sending"
  | "done"
  | "send_error"
  | "skipped";

interface DuplicateInfo {
  id: string;
  name: string;
  status: string;
  modalidade: string | null;
}

interface Entry {
  id: string;
  file: File;
  status: EntryStatus;
  message?: string;
  fileKind?: "pdf" | "docx";
  text?: string;
  clauseCount?: number;
  suggestionReason?: string;
  duplicate?: DuplicateInfo | null;
  docType: IngestDocType | null;
  subOption: string | null;
  criteria: Partial<Record<CriteriaField, string>>;
  /**
   * O operador confirmou trocar a cláusula de garantia deste arquivo AVULSO por
   * um slot. Sempre explícito: sem marcar, o modelo nasce com a cláusula fixa
   * (comportamento de sempre).
   */
  openSlot?: boolean;
  /** Garantidor da cláusula do slot no caminho avulso (rótulo humano). */
  slotProvider?: string;
  /** Resultado do commit — link de revisão do template criado. */
  templateId?: string;
}

/** O que a tela oferece a um arquivo avulso que pode abrir slot de garantia. */
interface SlotOffer {
  garantia: GarantiaTipo;
  candidate: SlotBlockCandidate;
  /** Palpite do garantidor lido do próprio trecho (default do campo). */
  provider: string | null;
}

interface GroupDecision {
  consolidate: boolean;
  /** fileId → opção do formulário (tipo de garantia). */
  values: Record<string, string>;
  /** fileId → garantidor da variante (rótulo humano, vazio = genérica). */
  providers: Record<string, string>;
}

/** O grupo cru + o que a tela precisa pra mostrar e consolidar. */
interface GroupView extends ConsolidationGroup {
  plan: ConsolidationPlan;
  matrix: DifferenceRow[];
  primary: DifferenceRow | null;
  suggested: Record<string, string>;
  suggestedProviders: Record<string, string>;
}

const CRITERIA_OPTIONS: Record<
  CriteriaField,
  { label: string; options: Array<{ value: string; label: string }> }
> = {
  garantia: {
    label: "Garantia",
    options: GARANTIA_TIPOS.map((v) => ({ value: v, label: GARANTIA_LABELS[v] })),
  },
  fiadorPessoa: {
    label: "Fiador é",
    options: (["pf", "pj"] as const).map((v) => ({ value: v, label: PESSOA_LABELS[v] })),
  },
  pessoa: {
    label: "Locatário/proponente é",
    options: (["pf", "pj"] as const).map((v) => ({ value: v, label: PESSOA_LABELS[v] })),
  },
  admImobiliaria: {
    label: "Administração pela imobiliária",
    // Valores como string porque o estado do diálogo é Record<_, string> (é o
    // que um <select> produz); `matchCriteriaSchema` coage na fronteira.
    options: [
      { value: "true", label: "Sim, a imobiliária administra" },
      { value: "false", label: "Não, o locador recebe direto" },
    ],
  },
};

/**
 * Central de ingestão de documentos da imobiliária.
 *
 * Substitui o "Importar modelos (.docx)": um único ponto de entrada que aceita N
 * arquivos DOCX **e** PDF e os leva por upload → análise → triagem → criação.
 *
 * O que a tela faz de diferente do diálogo antigo:
 *  - PERGUNTA "que documento é este?" na linguagem do usuário (não pede
 *    "modalidade"), com os tipos filtrados pelos módulos habilitados da org;
 *  - PAREIA de forma objetiva: as variantes usam as MESMAS opções do formulário
 *    (garantia, fiador PF/PJ, locatário PF/PJ) e viram `matchCriteria`;
 *  - CONSOLIDA modelos repetidos: arquivos quase idênticos são agrupados por
 *    diff determinístico (sem IA), o operador confirma a opção do form de cada
 *    variante, a base comum vira UM template com slot e os blocos divergentes
 *    viram cláusulas do acervo.
 *
 * A fila é SEQUENCIAL: tanto a análise quanto a criação são pipelines pesados
 * (extração/OCR, Drive, IA) e as rotas aceitam um arquivo por request.
 */
export function DocumentIngestionDialog({
  autoOpen = false,
  enabledModules,
}: {
  autoOpen?: boolean;
  /** Módulos habilitados da org — filtram os tipos oferecidos. */
  enabledModules: string[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(autoOpen);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"pick" | "triage" | "done">("pick");
  const [decisions, setDecisions] = useState<Record<string, GroupDecision>>({});

  const docTypes = useMemo<IngestDocTypeDef[]>(() => {
    const set = new Set(enabledModules);
    return INGEST_DOC_TYPE_DEFS.filter((d) => d.module === null || set.has(d.module));
  }, [enabledModules]);

  const patch = useCallback((id: string, next: Partial<Entry>) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...next } : e)));
  }, []);

  // ── Análise (fila sequencial) ────────────────────────────────────────────
  async function analyzeAll(files: File[]) {
    const initial: Entry[] = files.map((file, i) => ({
      id: `${i}-${file.name}-${file.size}`,
      file,
      status: "pending",
      docType: null,
      subOption: null,
      criteria: {},
    }));
    setEntries(initial);
    setPhase("triage");
    setBusy(true);

    for (const entry of initial) {
      patch(entry.id, { status: "analyzing" });
      try {
        const fd = new FormData();
        fd.append("file", entry.file);
        const res = await fetch("/api/templates/ingest/analyze", {
          method: "POST",
          body: fd,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? "Falha ao analisar o arquivo");
        patch(entry.id, {
          status: "ready",
          fileKind: data.fileKind,
          text: data.text,
          clauseCount: data.clauseCount,
          duplicate: data.duplicate ?? null,
          suggestionReason: data.suggestion?.reason,
          docType: data.suggestion?.type ?? null,
          subOption: data.suggestion?.subOption ?? null,
        });
      } catch (err) {
        patch(entry.id, {
          status: "analysis_error",
          message: err instanceof Error ? err.message : "Falha ao analisar",
        });
      }
    }
    setBusy(false);
  }

  // ── Garantia de cada arquivo (escolha do operador ou palpite) ────────────
  // É o que separa as famílias no agrupamento e o que rotula a cláusula do slot
  // no caminho avulso.
  const garantiaOf = useMemo(() => {
    const map = new Map<string, GarantiaTipo | null>();
    for (const e of entries) {
      if (!e.text) continue;
      map.set(
        e.id,
        normalizeGarantiaTipo(e.criteria.garantia) ?? guessDocumentGarantia(e.text)
      );
    }
    return map;
  }, [entries]);

  // ── Agrupamento (determinístico, no browser) ─────────────────────────────
  const groups = useMemo<GroupView[]>(() => {
    // Só DOCX de MODELO entram: PDF não vira template e cláusulas avulsas não
    // são variantes de nada.
    const candidates = entries.filter(
      (e) =>
        e.status === "ready" &&
        e.fileKind === "docx" &&
        e.text &&
        e.docType &&
        e.docType !== "clausulas"
    );
    if (candidates.length < 2) return [];

    const normalized = candidates.map((e) =>
      normalizeDoc({
        id: e.id,
        name: e.file.name,
        text: e.text ?? "",
        // Família FINA: modalidade + garantia. Só a modalidade juntaria numa
        // base única a locação com fiador e a com caução — o texto é o mesmo
        // menos uma cláusula —, e garantias diferentes são contratos
        // diferentes. O que pode (e deve) consolidar é a MESMA garantia com
        // fornecedores diferentes.
        family: ingestionFamilyKey({
          modalidade: modalidadeForIngest(e.docType!, e.subOption),
          garantia: garantiaOf.get(e.id) ?? null,
        }),
      })
    );
    const byId = new Map(normalized.map((n) => [n.id, n]));

    return groupSimilarDocs(normalized).map((g) => {
      const docs = g.memberIds.map((id) => byId.get(id)!);
      const plan = buildConsolidationPlan(docs);
      const matrix = buildDifferenceMatrix(plan);
      const primary = primaryDifferenceRow(matrix);
      const suggested: Record<string, string> = {};
      const suggestedProviders: Record<string, string> = {};
      for (const id of g.memberIds) {
        const text = (primary?.byDoc[id] ?? []).join("\n");
        const guess = text ? suggestGarantiaTipo(text) : null;
        if (guess) suggested[id] = guess;
        const provider = text ? suggestProviderName(text) : null;
        if (provider) suggestedProviders[id] = provider;
      }
      return { ...g, plan, matrix, primary, suggested, suggestedProviders };
    });
  }, [entries, garantiaOf]);

  const groupOf = useMemo(() => {
    const map = new Map<string, GroupView>();
    for (const g of groups) for (const id of g.memberIds) map.set(id, g);
    return map;
  }, [groups]);

  // ── Slot no arquivo avulso ───────────────────────────────────────────────
  // Sem consolidação não há "diferença entre variantes" pra isolar, então o
  // bloco candidato sai da heurística de trecho de garantia do próprio texto.
  // Exige garantia conhecida: é ela que TAGUEIA a cláusula no acervo — sem tag,
  // o slot cairia no texto canônico e a redação da imobiliária se perderia.
  const slotOffers = useMemo(() => {
    const map = new Map<string, SlotOffer>();
    for (const e of entries) {
      if (e.fileKind !== "docx" || !e.text || !e.docType || e.docType === "clausulas") {
        continue;
      }
      if (!ingestDocTypeDef(e.docType).slots.includes("garantia")) continue;
      const garantia = garantiaOf.get(e.id);
      if (!garantia) continue;
      const candidate = garantiaSlotCandidate(e.text);
      if (candidate) {
        map.set(e.id, {
          garantia,
          candidate,
          provider: suggestProviderName(candidate.paragraphs.join("\n")),
        });
      }
    }
    return map;
  }, [entries, garantiaOf]);

  function decisionFor(g: GroupView): GroupDecision {
    return (
      decisions[g.id] ?? {
        consolidate: true,
        values: { ...g.suggested },
        providers: { ...g.suggestedProviders },
      }
    );
  }

  function setDecision(g: GroupView, next: Partial<GroupDecision>) {
    setDecisions((prev) => ({
      ...prev,
      [g.id]: { ...decisionFor(g), ...next },
    }));
  }

  // ── Criação ──────────────────────────────────────────────────────────────

  /**
   * Grava as cláusulas do slot no acervo. Roda SEMPRE antes de criar o
   * template: o `applyClauseSlotToDoc` apaga o trecho do Doc, então uma cláusula
   * que não chegou ao acervo é redação da imobiliária perdida — a geração
   * cairia no texto canônico da plataforma sem ninguém perceber.
   */
  async function sendSlotClauses(input: {
    sourceName: string;
    variants: Array<{ value: string; provider?: string; content: string }>;
  }): Promise<void> {
    const res = await fetch("/api/templates/ingest/clauses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slot: "garantia",
        sourceName: input.sourceName,
        variants: input.variants,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error ?? "Falha ao gravar as cláusulas");
  }

  async function sendTemplate(
    entry: Entry,
    extra?: {
      slotBlocks?: Record<string, string[]>;
      /** Sobrescreve o `matchCriteria` do card (a consolidação monta o seu). */
      criteria?: Partial<Record<CriteriaField, string>>;
    }
  ): Promise<{ templateId: string | null; slotFailure: string | null }> {
    const modalidade = modalidadeForIngest(entry.docType!, entry.subOption);
    if (!modalidade) return { templateId: null, slotFailure: null };
    const criteria = extra?.criteria ?? entry.criteria;
    const fd = new FormData();
    fd.append("file", entry.file);
    fd.append("modalidade", modalidade);
    if (Object.keys(criteria).length) {
      fd.append("matchCriteria", JSON.stringify(criteria));
    }
    if (extra?.slotBlocks && Object.keys(extra.slotBlocks).length) {
      fd.append("slotBlocks", JSON.stringify(extra.slotBlocks));
    }
    const res = await fetch("/api/templates/from-docx", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data?.code === "DUPLICATE_TEMPLATE") {
      throw new Error("Este arquivo já foi importado antes — pule ou remova o antigo.");
    }
    if (!res.ok) throw new Error(data?.error ?? "Falha ao criar o modelo");
    // O slot é ADITIVO: a trava tudo-ou-nada pode ter recusado o bloco e o
    // modelo existe do mesmo jeito, com a cláusula fixa. Reportamos o motivo no
    // card em vez de tratar como erro de criação.
    return {
      templateId: (data.templateId as string) ?? null,
      slotFailure: slotFailureMessage(parseSlotReports(data.slots)),
    };
  }

  async function sendToAcervo(entry: Entry): Promise<void> {
    const fd = new FormData();
    fd.append("file", entry.file);
    // Sem `category`: o servidor classifica e, sendo coleção, segmenta cláusula
    // a cláusula. `force` porque a triagem JÁ decidiu que isto não é modelo.
    fd.append("force", "true");
    const res = await fetch("/api/knowledge/upload", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error ?? "Falha ao enviar pro acervo");
  }

  async function commit() {
    setBusy(true);
    const handled = new Set<string>();
    let templates = 0;
    let clauses = 0;
    let failures = 0;

    // 1) Grupos consolidados: representante vira o template com slot; os blocos
    //    divergentes de cada variante viram cláusulas do acervo.
    for (const g of groups) {
      const decision = decisionFor(g);
      if (!decision.consolidate) continue;
      const members = g.memberIds
        .map((id) => entries.find((e) => e.id === id))
        .filter((e): e is Entry => Boolean(e));
      const reference = members.find((m) => m.id === g.plan.referenceDocId);
      if (!reference || !g.primary) continue;

      const variants = members
        .map((m) => ({
          entry: m,
          value: decision.values[m.id],
          // Com a família fina o grupo tem UMA garantia: o que separa as
          // variantes no acervo é o garantidor (`provider:porto_seguro`).
          provider: decision.providers[m.id]?.trim() || undefined,
          content: (g.primary!.byDoc[m.id] ?? []).join("\n\n"),
        }))
        .filter((v) => v.value && v.content.trim().length >= 20);

      if (variants.length === 0) continue;

      for (const m of members) handled.add(m.id);
      members.forEach((m) => patch(m.id, { status: "sending" }));

      try {
        // ORDEM IMPORTA: as cláusulas primeiro. Se elas falharem, abortamos sem
        // ter criado nada — e o operador só reaperta "Confirmar e criar". Na
        // ordem inversa, uma falha aqui deixaria um template com slot apontando
        // pra um acervo vazio, e o retry esbarraria no 409 de duplicata (o
        // arquivo já teria virado template) — sem caminho de conserto na tela.
        await sendSlotClauses({
          sourceName: reference.file.name.replace(/\.docx$/i, ""),
          variants: variants.map((v) => ({
            value: v.value,
            provider: v.provider,
            content: v.content,
          })),
        });
        clauses += variants.length;

        // O grupo tem UMA garantia (a família é `modalidade:garantia`), então o
        // modelo é marcado com ela: sem nenhum eixo no `matchCriteria` ele
        // pontua 0 no pareamento e nunca é escolhido por um fato do formulário.
        // O que discrimina o FORNECEDOR continua sendo o slot, não o critério.
        const created = await sendTemplate(reference, {
          slotBlocks: { garantia: g.primary.byDoc[reference.id] ?? [] },
          criteria: consolidatedMatchCriteria({
            familyGarantia: garantiaOf.get(reference.id) ?? null,
            variantValues: members.map((m) => decision.values[m.id]),
            memberCriteria: members.map((m) => m.criteria),
          }),
        });
        templates += 1;

        patch(reference.id, {
          status: "done",
          templateId: created.templateId ?? undefined,
          message:
            created.slotFailure ??
            `Modelo da família criado com slot de garantia · ${variants.length} cláusula(s) no acervo`,
        });
        const labeled = new Set(variants.map((v) => v.entry.id));
        for (const m of members) {
          if (m.id === reference.id) continue;
          patch(m.id, {
            status: "done",
            // Honestidade sobre o que aconteceu com cada arquivo: sem opção do
            // formulário escolhida, a versão não virou cláusula — a garantia
            // dela vai cair no texto padrão do sistema na geração.
            message: labeled.has(m.id)
              ? "Consolidado — virou variante de garantia do modelo da família"
              : "Sem opção do formulário escolhida — esta versão não virou cláusula",
          });
        }
      } catch (err) {
        failures += 1;
        const msg = err instanceof Error ? err.message : "Falha na consolidação";
        for (const m of members) {
          patch(m.id, {
            status: "send_error",
            message: `${msg} — nada foi criado para este grupo. Clique em "Tentar de novo" para repetir.`,
          });
        }
      }
    }

    // 2) Arquivos avulsos (e grupos que o operador decidiu NÃO consolidar).
    for (const entry of entries) {
      if (handled.has(entry.id)) continue;
      if (entry.status !== "ready") continue;
      // PDF nunca vira modelo (não preserva o timbrado) — vai pro acervo mesmo
      // sem tipo escolhido, que é o que o banner do card já anunciou.
      if (!entry.docType && entry.fileKind !== "pdf") {
        patch(entry.id, { status: "skipped", message: "Sem tipo escolhido" });
        continue;
      }
      patch(entry.id, { status: "sending" });
      try {
        if (entry.docType === "clausulas" || entry.fileKind === "pdf") {
          await sendToAcervo(entry);
          clauses += 1;
          patch(entry.id, { status: "done", message: "Enviado pro acervo" });
        } else {
          // Slot no arquivo AVULSO: só quando o operador confirmou no card. A
          // ordem é a mesma da consolidação (cláusula primeiro, template
          // depois) e pela mesma razão — falha aqui não deixa um modelo com
          // slot apontando pro vazio, e o retry não esbarra no 409 de duplicata.
          const offer = entry.openSlot ? slotOffers.get(entry.id) : undefined;
          if (offer) {
            await sendSlotClauses({
              sourceName: entry.file.name.replace(/\.docx$/i, ""),
              variants: [
                {
                  value: offer.garantia,
                  provider:
                    (entry.slotProvider ?? offer.provider ?? "").trim() || undefined,
                  content: offer.candidate.paragraphs.join("\n\n"),
                },
              ],
            });
            clauses += 1;
          }
          const created = await sendTemplate(
            entry,
            offer ? { slotBlocks: { garantia: offer.candidate.paragraphs } } : undefined
          );
          templates += 1;
          patch(entry.id, {
            status: "done",
            templateId: created.templateId ?? undefined,
            message:
              created.slotFailure ??
              (offer
                ? "Modelo criado com espaço de garantia · 1 cláusula no acervo — revise antes de ativar"
                : "Modelo criado — revise antes de ativar"),
          });
        }
      } catch (err) {
        failures += 1;
        const msg = err instanceof Error ? err.message : "Falha ao criar";
        patch(entry.id, {
          status: "send_error",
          message: `${msg} — nada foi criado para este arquivo.`,
        });
      }
    }

    setBusy(false);
    setPhase("done");
    if (templates || clauses) {
      toast.success(
        `${templates} modelo(s) e ${clauses} item(ns) no acervo` +
          (failures ? ` · ${failures} falha(s)` : "")
      );
      router.refresh();
    } else if (failures) {
      toast.error(`Nada foi criado — ${failures} falha(s).`);
    }
  }

  function reset() {
    setEntries([]);
    setDecisions({});
    setPhase("pick");
    if (fileRef.current) fileRef.current.value = "";
  }

  const readyCount = entries.filter((e) => e.status === "ready").length;
  const failedCount = entries.filter((e) => e.status === "send_error").length;
  const analyzed = entries.filter(
    (e) => e.status !== "pending" && e.status !== "analyzing"
  ).length;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (!next) reset();
      }}
    >
      <Button size="sm" onClick={() => setOpen(true)}>
        <FileUp className="mr-1.5 h-4 w-4" />
        Enviar documentos da imobiliária
      </Button>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Mande seus modelos do jeito que eles estão</DialogTitle>
          <DialogDescription>
            Contratos, propostas e cláusulas, em DOCX ou PDF, todos de uma vez.
            Nós lemos cada arquivo, dizemos o que achamos que é e você confirma.
          </DialogDescription>
        </DialogHeader>

        {phase === "pick" && (
          <div className="space-y-4">
            <ol className="grid gap-2.5 rounded-lg border bg-muted/40 p-3">
              {[
                {
                  t: "Você envia",
                  d: "Arraste tudo que a imobiliária usa hoje — não precisa arrumar nada antes.",
                },
                {
                  t: "Nós organizamos",
                  d: "Agrupamos os parecidos num modelo só e separamos o que é cláusula.",
                },
                {
                  t: "Você confirma",
                  d: "Confere a sugestão e a biblioteca da sua imobiliária fica montada.",
                },
              ].map((s, i) => (
                <li key={s.t} className="flex items-start gap-2.5">
                  <span className="mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full bg-background text-[11px] font-bold tabular-nums">
                    {i + 1}
                  </span>
                  <span className="text-sm leading-snug">
                    <strong className="font-semibold">{s.t}</strong>
                    <span className="text-muted-foreground"> — {s.d}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="rounded-lg border border-violet-300 bg-violet-50/50 px-3 py-2 text-xs leading-snug dark:border-violet-900 dark:bg-violet-950/20">
              Pode enviar vários arquivos repetidos — o mesmo contrato com
              fiador, com caução, um por seguradora. É esperado: cada garantia
              vira um modelo próprio (são contratos diferentes) e as versões que
              só mudam de fornecedor viram um modelo só, com a cláusula da
              seguradora escolhida pelo formulário.
            </p>
            <div className="space-y-1.5">
              <Label>Arquivos (DOCX ou PDF, até 20MB cada)</Label>
              <Input ref={fileRef} type="file" accept=".docx,.pdf" multiple />
              <p className="text-xs text-muted-foreground">
                Modelo de contrato precisa ser DOCX — é o que preserva o timbrado.
                PDF entra como referência no acervo.
              </p>
            </div>
            <Button
              className="w-full"
              onClick={() => {
                const files = Array.from(fileRef.current?.files ?? []);
                if (files.length === 0) {
                  toast.error("Selecione ao menos um arquivo.");
                  return;
                }
                void analyzeAll(files);
              }}
            >
              Analisar os arquivos
            </Button>
          </div>
        )}

        {phase !== "pick" && (
          <div className="space-y-4">
            {busy && (
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>
                  {phase === "triage"
                    ? `Analisando ${analyzed} de ${entries.length}…`
                    : "Criando…"}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  Não feche esta janela
                </span>
              </div>
            )}

            {groups.map((g) => (
              <GroupCard
                key={g.id}
                group={g}
                entries={entries}
                docTypes={docTypes}
                decision={decisionFor(g)}
                disabled={busy || phase === "done"}
                onChange={(next) => setDecision(g, next)}
                onChangeType={(docType, subOption) => {
                  // O tipo vale pro GRUPO INTEIRO: os membros são o mesmo
                  // documento variando uma cláusula, então salvá-los em
                  // modalidades diferentes é sempre erro.
                  for (const id of g.memberIds) {
                    patch(id, { docType, subOption, criteria: {} });
                  }
                }}
              />
            ))}

            <ul className="space-y-3">
              {entries
                .filter((e) => !groupOf.has(e.id) || !decisionFor(groupOf.get(e.id)!).consolidate)
                .map((entry) => (
                  <li key={entry.id}>
                    <FileCard
                      entry={entry}
                      docTypes={docTypes}
                      slotOffer={slotOffers.get(entry.id)}
                      disabled={busy}
                      onChange={(next) => patch(entry.id, next)}
                    />
                  </li>
                ))}
            </ul>

            {!busy && phase === "triage" && (
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={reset}>
                  Recomeçar
                </Button>
                <Button
                  className="flex-1"
                  disabled={readyCount === 0}
                  onClick={() => void commit()}
                >
                  Confirmar e criar
                </Button>
              </div>
            )}

            {!busy && phase === "done" && (
              <div className="flex flex-wrap gap-2">
                {failedCount > 0 && (
                  <Button
                    variant="secondary"
                    className="flex-1"
                    onClick={() => {
                      // Nada foi criado pros itens que falharam (a criação é
                      // abortiva por grupo/arquivo), então basta devolvê-los
                      // à fila e repetir.
                      setEntries((prev) =>
                        prev.map((e) =>
                          e.status === "send_error"
                            ? { ...e, status: "ready", message: undefined }
                            : e
                        )
                      );
                      setPhase("triage");
                    }}
                  >
                    Tentar de novo ({failedCount})
                  </Button>
                )}
                <Button variant="outline" className="flex-1" onClick={reset}>
                  Enviar outros
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => {
                    setOpen(false);
                    reset();
                  }}
                >
                  Concluir
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Card de um arquivo
// ────────────────────────────────────────────────────────────────────────────

function FileCard({
  entry,
  docTypes,
  slotOffer,
  disabled,
  onChange,
}: {
  entry: Entry;
  docTypes: IngestDocTypeDef[];
  /** Bloco de garantia que este arquivo pode transformar em slot (se houver). */
  slotOffer?: SlotOffer;
  disabled: boolean;
  onChange: (next: Partial<Entry>) => void;
}) {
  const def = entry.docType ? ingestDocTypeDef(entry.docType) : null;
  const isPdf = entry.fileKind === "pdf";

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start gap-2">
        <StatusIcon status={entry.status} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{entry.file.name}</p>
          {entry.message && (
            <p className="text-xs text-muted-foreground">{entry.message}</p>
          )}
          {entry.status === "ready" && entry.suggestionReason && (
            <p className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
              <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-violet-500" />
              <span>{entry.suggestionReason}</span>
            </p>
          )}
        </div>
        {entry.templateId && (
          <Button asChild size="sm" variant="ghost">
            <Link href={`/templates/${entry.templateId}/review`}>Revisar</Link>
          </Button>
        )}
      </div>

      {entry.status === "ready" && entry.duplicate && (
        <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Este arquivo já foi importado como{" "}
          <Link
            href={`/templates/${entry.duplicate.id}/review`}
            className="font-medium underline"
          >
            {entry.duplicate.name}
          </Link>
          . Criar de novo vai falhar — remova o arquivo do lote ou arquive o
          modelo antigo.
        </p>
      )}

      {entry.status === "ready" && isPdf && (
        <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs dark:border-amber-800 dark:bg-amber-950/40">
          <p className="flex items-start gap-1.5 font-medium text-amber-900 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Modelo de contrato precisa ser DOCX
          </p>
          <p className="mt-1 text-amber-900/80 dark:text-amber-200/80">
            É o DOCX que preserva o timbrado, as fontes e o layout de vocês. Este
            PDF vai para o acervo (a IA passa a consultá-lo). Se ele é um modelo
            que vocês usam, envie o .docx original.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-background px-2 py-1 font-medium">
              <Check className="mr-1 h-3 w-3" /> Enviar pro acervo
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled
              title="Em breve: a IA reconstrói o layout do PDF em DOCX e você revisa cada página antes de ativar. Enquanto isso, envie o .docx original."
            >
              Conversão assistida por IA (em breve)
            </Button>
          </div>
        </div>
      )}

      {entry.status === "ready" && !isPdf && (
        <div className="mt-3 space-y-2">
          <div className="space-y-1">
            <Label className="text-xs">Que documento é este?</Label>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={entry.docType ?? ""}
              disabled={disabled}
              onChange={(e) => {
                const next = (e.target.value || null) as IngestDocType | null;
                const nextDef = next ? ingestDocTypeDef(next) : null;
                onChange({
                  docType: next,
                  subOption: nextDef?.subOptions[0]?.value ?? null,
                  criteria: {},
                  // Outro tipo, outro bloco candidato (ou nenhum): a confirmação
                  // de abrir o slot valia pro que estava escolhido antes.
                  openSlot: false,
                });
              }}
            >
              <option value="">Escolha…</option>
              {docTypes.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
            {def && <p className="text-xs text-muted-foreground">{def.description}</p>}
          </div>

          {def && def.subOptions.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">{def.subLabel}</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={entry.subOption ?? def.subOptions[0].value}
                disabled={disabled}
                onChange={(e) => onChange({ subOption: e.target.value })}
              >
                {def.subOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {def && def.criteria.length > 0 && (
            <div className="rounded-md bg-muted/40 p-2">
              <p className="mb-1.5 text-xs text-muted-foreground">
                Este modelo vale para qual situação? São as mesmas opções do
                formulário — deixe em branco o que não muda.
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                {def.criteria.map((field) => (
                  <div key={field} className="space-y-1">
                    <Label className="text-xs">{CRITERIA_OPTIONS[field].label}</Label>
                    <select
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                      value={entry.criteria[field] ?? ""}
                      disabled={disabled}
                      onChange={(e) => {
                        const next = { ...entry.criteria };
                        if (e.target.value) next[field] = e.target.value;
                        else delete next[field];
                        onChange({ criteria: next });
                      }}
                    >
                      <option value="">Qualquer</option>
                      {CRITERIA_OPTIONS[field].options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {slotOffer && (
            <div className="rounded-md border border-violet-300 bg-violet-50/50 p-2.5 dark:border-violet-900 dark:bg-violet-950/20">
              <p className="text-xs font-medium">
                Transformar a cláusula de{" "}
                {GARANTIA_LABELS[slotOffer.garantia].toLowerCase()} num espaço
                reutilizável?
              </p>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                O trecho abaixo sai do modelo e vai para o acervo como a cláusula
                de {GARANTIA_LABELS[slotOffer.garantia].toLowerCase()}. No lugar
                dele fica um espaço que recebe a cláusula do fornecedor escolhido
                no formulário — é assim que trocar de seguradora deixa de exigir
                um modelo novo.
              </p>
              <p className="mt-1.5 rounded bg-background px-2 py-1.5 text-[11px] leading-snug">
                {slotOffer.candidate.paragraphs.join(" ").slice(0, 240)}
                {slotOffer.candidate.paragraphs.join(" ").length > 240 ? "…" : ""}
              </p>
              {slotOffer.candidate.skipped.length > 0 && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {slotOffer.candidate.skipped.length} trecho(s) vizinho(s)
                  continuam no modelo — são curtos demais ou se repetem no
                  documento, e trocá-los mexeria no lugar errado.
                </p>
              )}
              <label className="mt-1.5 flex items-start gap-1.5 text-[11px]">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={entry.openSlot === true}
                  disabled={disabled}
                  onChange={(e) => onChange({ openSlot: e.target.checked })}
                />
                <span>
                  Sim, abrir o espaço de garantia neste modelo. Sem marcar, o
                  modelo fica com esta cláusula fixa, como hoje.
                </span>
              </label>
              {entry.openSlot && (
                <div className="mt-1.5 flex items-center gap-2">
                  <Label className="text-[11px]">Fornecedor desta redação</Label>
                  <Input
                    className="h-7 flex-1 text-xs"
                    placeholder="Ex.: Porto Seguro (vazio = vale para qualquer um)"
                    value={entry.slotProvider ?? slotOffer.provider ?? ""}
                    disabled={disabled}
                    onChange={(e) => onChange({ slotProvider: e.target.value })}
                  />
                </div>
              )}
            </div>
          )}

          {def && def.subOptions.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Vai virar um modelo de{" "}
              <strong>
                {modalidadeLabel(modalidadeForIngest(def.key, entry.subOption))}
              </strong>
              .
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Card de um grupo consolidável
// ────────────────────────────────────────────────────────────────────────────

function GroupCard({
  group,
  entries,
  docTypes,
  decision,
  disabled,
  onChange,
  onChangeType,
}: {
  group: GroupView;
  entries: Entry[];
  docTypes: IngestDocTypeDef[];
  decision: GroupDecision;
  disabled: boolean;
  onChange: (next: Partial<GroupDecision>) => void;
  onChangeType: (docType: IngestDocType | null, subOption: string | null) => void;
}) {
  const members = group.memberIds
    .map((id) => entries.find((e) => e.id === id))
    .filter((e): e is Entry => Boolean(e));
  // Todos os membros compartilham tipo/sub-opção (a família é pré-requisito do
  // agrupamento); o primeiro representa o grupo.
  const lead = members[0];
  const def = lead?.docType ? ingestDocTypeDef(lead.docType) : null;
  const modalidade = lead?.docType
    ? modalidadeForIngest(lead.docType, lead.subOption)
    : null;
  // Quando o grupo se formou por CONTENÇÃO, o "% idêntico" (Dice) subestima a
  // parecença — é o caso "um dos arquivos tem um bloco grande a mais" (rider de
  // seguradora, por exemplo). Contar a mesma história com o número errado faria
  // o operador desconfiar de um agrupamento correto.
  const pct = Math.round(
    (group.linkedBy === "containment" ? group.minContainment : group.minSimilarity) * 100
  );
  const otherRows = group.matrix.filter(
    (r) => r.anchorIndex !== group.primary?.anchorIndex
  );
  const collisions = collidingVariantValues(
    members.map((m) => ({
      value: decision.values[m.id],
      provider: decision.providers[m.id],
    }))
  );

  return (
    <div className="rounded-lg border border-violet-300 bg-violet-50/50 p-3 dark:border-violet-900 dark:bg-violet-950/20">
      <div className="flex items-start gap-2">
        <Layers className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            Estes {members.length} arquivos parecem o mesmo documento
          </p>
          <p className="text-xs text-muted-foreground">
            {group.linkedBy === "containment"
              ? `${pct}% do menor está inteiro dentro do maior — um deles traz um bloco a mais.`
              : `${pct}% do texto é idêntico.`}{" "}
            O que muda é a cláusula abaixo — dá pra juntar tudo num modelo só,
            com a cláusula escolhida pelo formulário.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={decision.consolidate}
            disabled={disabled}
            onChange={(e) => onChange({ consolidate: e.target.checked })}
          />
          Consolidar
        </label>
      </div>

      {decision.consolidate && (
        <div className="mt-3 space-y-2">
          {/* O TIPO em destaque: o operador confirma o grupo de uma vez só, e
              foi exatamente aqui que um palpite errado passou batido no QA — um
              contrato de locação nasceu como modelo de PROPOSTA. Fica no topo
              do card, com o nome da modalidade por extenso e o seletor à mão. */}
          <div className="rounded-md border border-violet-300 bg-background p-2.5 dark:border-violet-900">
            <Label className="text-xs font-semibold">
              Estes {members.length} arquivos são: <span className="text-destructive">*</span>
            </Label>
            <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-medium"
                value={lead?.docType ?? ""}
                disabled={disabled}
                onChange={(e) => {
                  const next = (e.target.value || null) as IngestDocType | null;
                  const nextDef = next ? ingestDocTypeDef(next) : null;
                  onChangeType(next, nextDef?.subOptions[0]?.value ?? null);
                }}
              >
                <option value="">Escolha…</option>
                {docTypes
                  .filter((d) => d.key !== "clausulas")
                  .map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.label}
                    </option>
                  ))}
              </select>
              {def && def.subOptions.length > 0 && (
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  aria-label={def.subLabel}
                  value={lead?.subOption ?? def.subOptions[0].value}
                  disabled={disabled}
                  onChange={(e) => onChangeType(lead?.docType ?? null, e.target.value)}
                >
                  {def.subOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {def && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {def.description}
              </p>
            )}
            <p className="mt-1 text-[11px]">
              {modalidade ? (
                <>
                  Vai virar <strong>um</strong> modelo de{" "}
                  <strong>{modalidadeLabel(modalidade)}</strong>, com a garantia
                  escolhida pelo formulário. Confira antes de confirmar.
                </>
              ) : (
                <span className="text-destructive">
                  Escolha o tipo — sem ele o grupo não é criado.
                </span>
              )}
            </p>
          </div>

          {members.map((m) => {
            const blocks = group.primary?.byDoc[m.id] ?? [];
            const preview = blocks.join(" ").slice(0, 220);
            return (
              <div key={m.id} className="rounded-md border bg-background p-2">
                <div className="flex items-start gap-1.5">
                  <StatusIcon status={m.status} />
                  <p className="min-w-0 flex-1 truncate text-xs font-medium">
                    {m.file.name}
                    {m.id === group.plan.referenceDocId && (
                      <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                        base do modelo
                      </span>
                    )}
                  </p>
                  {m.templateId && (
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/templates/${m.templateId}/review`}>Revisar</Link>
                    </Button>
                  )}
                </div>
                {m.message && (
                  <p className="text-[11px] text-muted-foreground">{m.message}</p>
                )}
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                  {preview ? `${preview}${blocks.join(" ").length > 220 ? "…" : ""}` : "— sem cláusula própria nesta posição"}
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <Label className="text-[11px]">Esta versão é a de</Label>
                  <select
                    className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                    value={decision.values[m.id] ?? ""}
                    disabled={disabled || blocks.length === 0}
                    onChange={(e) =>
                      onChange({
                        values: { ...decision.values, [m.id]: e.target.value },
                      })
                    }
                  >
                    <option value="">Escolha a garantia…</option>
                    {GARANTIA_TIPOS.map((v) => (
                      <option key={v} value={v}>
                        {GARANTIA_LABELS[v]}
                      </option>
                    ))}
                  </select>
                  <Input
                    className="h-7 flex-1 text-xs"
                    aria-label="Fornecedor desta versão"
                    placeholder="Fornecedor (ex.: Porto Seguro)"
                    value={decision.providers[m.id] ?? ""}
                    disabled={disabled || blocks.length === 0}
                    onChange={(e) =>
                      onChange({
                        providers: { ...decision.providers, [m.id]: e.target.value },
                      })
                    }
                  />
                </div>
              </div>
            );
          })}

          {collisions.length > 0 && (
            // O servidor recusa o lote inteiro (422) quando duas versões da
            // mesma garantia não têm garantidor que as separe — elas seriam a
            // MESMA cláusula do acervo. Avisar aqui evita a viagem perdida.
            <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              Duas versões estão marcadas como{" "}
              {collisions
                .map((v) => GARANTIA_LABELS[v as GarantiaTipo] ?? v)
                .join(", ")}{" "}
              com o mesmo fornecedor. Informe o fornecedor de cada uma (é ele que
              separa a redação de cada seguradora no acervo) — sem isso o grupo
              não é criado.
            </p>
          )}

          {otherRows.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Há {otherRows.length} outra(s) diferença(s) menor(es) entre os
              arquivos (numeração, qualificação do fiador no preâmbulo). Elas
              ficam no texto do modelo base — revise depois de criar.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: EntryStatus }) {
  if (status === "done") return <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />;
  if (status === "analysis_error" || status === "send_error")
    return <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />;
  if (status === "skipped")
    return <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />;
  if (status === "ready") return <FileText className="mt-0.5 h-4 w-4 shrink-0" />;
  return (
    <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
  );
}
