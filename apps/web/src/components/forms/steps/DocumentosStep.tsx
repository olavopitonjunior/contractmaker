"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Upload, Sparkles } from "lucide-react";
import { upload } from "@vercel/blob/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocumentCard, type DocumentCardData } from "@/components/forms/DocumentCard";
import type { SelectGroup } from "@/components/forms/NativeSelect";
import {
  isUncatalogedPersonDoc,
  type Assignment,
  type DocumentKind,
  type FichaResumoData,
  type ProcessedDocHint,
} from "@/lib/forms/extracted-to-form";
import {
  createVendaAdapter,
  filterAssignmentOptionsByScope,
  readPersistedAssignment,
  type DocumentosStepAdapter,
} from "@/components/forms/steps/doc-step-adapter";
import { MAX_ASSIGNMENT_INDEX } from "@/lib/forms/assignment-scope";
import { mapAttachmentStatusToCard } from "@/lib/forms/attachment-status";

interface DocumentosStepProps {
  form: UseFormReturn<any>;
  token: string;
  /**
   * Pontos role-shaped (slots, sugestão, autofill). Default = venda
   * (vendedores/compradores/imoveis); locação injeta o locacaoDocAdapter.
   * O encanamento de upload/polling é o mesmo pras duas esteiras.
   */
  adapter?: DocumentosStepAdapter;
  /**
   * Escopo por papel nos links por parte (`ROLE_PATHS[role]`). Quando presente,
   * os slots de atribuição e a auto-sugestão ficam restritos às chaves top-level
   * do papel — a parte não atribui um doc a um slot fora do escopo (o autofill
   * seria descartado no save). undefined = token principal (todos os slots).
   */
  allowedTopKeys?: readonly string[];
  /**
   * Link individual: o slot do PRÓPRIO participante (role + partyIndex).
   * Quando presente, um doc de identidade extraído cuja sugestão heurística
   * não casou (kind "outro" — o form da parte costuma estar vazio) é
   * atribuído automaticamente a este slot e aplicado com skipIfDirty (Fix 4).
   * Sem isso, o gate H.5 desabilitava "Aplicar aos campos" e a parte saía com
   * a OCR pronta mas nenhum campo preenchido (caso real prod 2026-07-23).
   * undefined = token principal (fluxo manual inalterado).
   */
  selfAssignment?: Assignment;
  /**
   * Visitante é membro da imobiliária (`viewerIsOrgMember`, resolvido no
   * server). Só ele remove documento pelo formulário — o link normalmente está
   * com o cliente, e antes qualquer portador apagava documento de qualquer
   * parte sem deixar rastro. O DELETE da rota faz a mesma checagem; isto aqui é
   * só a metade visual.
   *
   * Default false, e o link por parte (subtoken) segue removendo o que ELE
   * mesmo enviou — correção do próprio upload, não exclusão de documento alheio.
   */
  viewerIsMember?: boolean;
}

// 20MB de verdade: o upload agora é client-direct pro Blob
// (`attachments/blob-upload` + `/finalize`), então o arquivo não passa mais
// pelo corpo da função e o teto de ~4.5MB da Vercel deixou de valer.
const MAX_BYTES = 20 * 1024 * 1024;
const RESIZE_MAX_SIDE = 1500;
const IMAGE_JPEG_QUALITY = 0.8;
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ACCEPTED_MIMES = [...IMAGE_MIMES, "application/pdf"];
// Upload pool: 4 concurrent HTTP uploads to Blob/S3. Não toca Gemini.
// OCR é ON-DEMAND: o POST /attachments cria o anexo com status
// "awaiting_user" e NÃO enfileira worker — o usuário clica "Extrair com IA"
// (POST /attachments/[id]/retry) quando quiser gastar tokens. O polling no
// GET /attachments acompanha o resultado depois do clique.
const UPLOAD_CONCURRENCY = 4;

/**
 * Tiny inline pLimit — runs at most `concurrency` async tasks at the same time.
 * Used to parallelize multi-file upload + OCR without overwhelming Gemini or
 * exhausting the browser's per-origin fetch budget.
 */
function pLimit(concurrency: number) {
  const queue: Array<() => void> = [];
  let active = 0;
  const next = () => {
    active--;
    if (queue.length > 0) {
      const fn = queue.shift();
      fn?.();
    }
  };
  return <T,>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn()
          .then((v) => {
            resolve(v);
            next();
          })
          .catch((e) => {
            reject(e);
            next();
          });
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
}

async function resizeImage(file: File, maxSide: number): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const longest = Math.max(width, height);
    if (longest <= maxSide) return file;
    const ratio = maxSide / longest;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", IMAGE_JPEG_QUALITY)
    );
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
      type: "image/jpeg",
    });
  } catch {
    return file;
  }
}

interface FormSlotData {
  vendedores?: any[];
  compradores?: any[];
  imoveis?: any[];
}

const PARENT_KINDS = new Set<DocumentKind>(["vendedor", "comprador", "imovel"]);

function slotName(
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

function buildAssignmentOptions(
  snapshot: FormSlotData,
  docs: DocumentCardData[]
): SelectGroup[] {
  // Compute the visible count for each kind: max of (form snapshot length,
  // highest index any doc is assigned to + 1, default 1)
  const maxAssigned = (kind: DocumentKind) =>
    docs.reduce(
      (m, d) => (d.assignment.kind === kind ? Math.max(m, d.assignment.index) : m),
      -1
    );
  const vCount = Math.max(
    1,
    snapshot.vendedores?.length ?? 1,
    maxAssigned("vendedor") + 1
  );
  const cCount = Math.max(
    1,
    snapshot.compradores?.length ?? 1,
    maxAssigned("comprador") + 1
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

  /**
   * Cônjuges e representantes derivam do papel da parte pai. Renderizamos só
   * os slots cuja parte pai é casada (cônjuge) ou PJ (representante).
   */
  const buildSubKindOptions = (
    kind:
      | "conjuge_vendedor"
      | "conjuge_comprador"
      | "representante_vendedor"
      | "representante_comprador",
    parentList: any[] | undefined,
    parentLabel: string,
    sub: "conjuge" | "representante"
  ) => {
    const opts: Array<{ value: string; label: string }> = [];
    if (!Array.isArray(parentList)) return opts;
    for (let i = 0; i < parentList.length; i++) {
      const parent = parentList[i];
      if (sub === "conjuge") {
        if (parent?.tipo_pessoa === "juridica") continue;
        if (
          parent?.estado_civil !== "Casado(a)" &&
          parent?.estado_civil !== "União Estável"
        ) {
          continue;
        }
      } else {
        if (parent?.tipo_pessoa !== "juridica") continue;
      }
      const parentName =
        sub === "conjuge"
          ? (parent?.nome as string | undefined)
          : (parent?.razao_social as string | undefined);
      const baseLabel =
        sub === "conjuge"
          ? `Cônjuge de ${parentLabel} ${i + 1}`
          : `Representante de ${parentLabel} ${i + 1}`;
      opts.push({
        value: `${kind}:${i}`,
        label: parentName ? `${baseLabel} — ${parentName.trim()}` : baseLabel,
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
    ...buildSubKindOptions("conjuge_vendedor", snapshot.vendedores, "Vendedor", "conjuge"),
    ...buildSubKindOptions("conjuge_comprador", snapshot.compradores, "Comprador", "conjuge"),
  ];
  if (conjugeOptions.length > 0) {
    groups.push({ label: "Cônjuges", options: conjugeOptions });
  }

  const representanteOptions = [
    ...buildSubKindOptions("representante_vendedor", snapshot.vendedores, "Vendedor", "representante"),
    ...buildSubKindOptions("representante_comprador", snapshot.compradores, "Comprador", "representante"),
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

/**
 * Categorias elegíveis pro auto-assign do link individual (Fix 4): documentos
 * DA PRÓPRIA pessoa. Procuração fica fora — descreve um representante, não o
 * titular do link. Ficha-resumo tem fluxo próprio (applyFicha).
 */
const SELF_ASSIGN_CATEGORIES = new Set([
  "rg",
  "cpf",
  "cnh",
  "comprovante_residencia",
  "certidao_casamento",
]);

/**
 * Doc elegível pro auto-assign do link individual: categoria da whitelist OU
 * doc fora do catálogo do classificador ("outro") com evidência de identidade
 * pessoal (carteira da OAB/CRM/CTPS trazem nome+cpf+rg). Mesma regra por
 * evidência do `mapExtractedToForm`.
 */
function isSelfAssignable(
  category: string | null,
  fields: Record<string, unknown> | null
): boolean {
  if (!category) return false;
  return (
    SELF_ASSIGN_CATEGORIES.has(category) || isUncatalogedPersonDoc(category, fields)
  );
}

export function DocumentosStep({
  form,
  token,
  adapter: adapterProp,
  allowedTopKeys,
  selfAssignment,
  viewerIsMember = false,
}: DocumentosStepProps) {
  const adapter = useMemo(
    () => adapterProp ?? createVendaAdapter(buildAssignmentOptions),
    [adapterProp]
  );
  const [docs, setDocs] = useState<DocumentCardData[]>([]);
  const [dragging, setDragging] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Tracking de ficha-resumo já auto-aplicada (Fase E). Evita loop quando
  // a aplicação altera o snapshot do form e re-dispara o effect.
  const appliedFichasRef = useRef<Set<string>>(new Set());
  // Docs cujo assignment PERSISTIDO já foi auto-aplicado aos campos (Fix 3).
  // Evita loop e reaplicações repetidas do mesmo doc.
  const autoAppliedRef = useRef<Set<string>>(new Set());
  // Docs já auto-atribuídos ao próprio participante (Fix 4) — idempotência.
  const selfAssignedRef = useRef<Set<string>>(new Set());

  // Estabilidade referencial do escopo pra deps de effects/callbacks.
  const allowedKey = allowedTopKeys ? allowedTopKeys.join("|") : "";

  // Auto-sugestão escopada por papel (Fix 2): nos links por parte, uma sugestão
  // que caia fora do `allowedTopKeys` é rebaixada pra "outro" — a pessoa escolhe
  // um slot do próprio papel no dropdown (já filtrado). No token principal
  // (allowedTopKeys undefined) é um passthrough do adapter.suggest.
  const scopedSuggest = useCallback(
    (
      category: string | null,
      fields: Record<string, unknown>,
      snapshot: Record<string, unknown>,
      siblings: ProcessedDocHint[] = []
    ): Assignment => {
      const a = adapter.suggest(category, fields, snapshot, siblings);
      if (!allowedTopKeys) return a;
      const topKey = adapter.topKeyForKind(a.kind);
      if (topKey !== null && !allowedTopKeys.includes(topKey)) {
        return { kind: "outro", index: 0 };
      }
      return a;
    },
    // allowedTopKeys capturado via allowedKey pra estabilidade referencial.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adapter, allowedKey]
  );

  // Restore previously uploaded attachments. Documents without extractedData
  // are marked as "failed" (instead of the misleading "uploading") so the user
  // can retry or remove them — they have been uploaded but never extracted,
  // which almost always means the last extraction attempt hit a 500/timeout.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/forms/${token}/attachments`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const snapshot = form.getValues();
        const restored: DocumentCardData[] = (data.attachments || []).map((a: any) => {
          const extracted = a.extractedData || {};
          const fields = extracted.fields || null;
          // Fix 1: prefere o assignment PERSISTIDO (escolha da parte, salvo pelo
          // PATCH em handleApply) em vez de re-sugerir — assim a categorização
          // feita no link individual reflete no principal e o doc não cai em
          // "outro". Sem persistido, cai no heurístico (escopado por papel).
          const persisted = readPersistedAssignment(extracted);
          const assignment =
            persisted ?? scopedSuggest(a.category, fields || {}, snapshot);
          // Mapeamento canônico server → card em lib/forms/attachment-status
          // (compartilhado com polling e doUpload — não duplicar aqui).
          const cardStatus = mapAttachmentStatusToCard(a.status, !!fields);
          // Phase F.I-α+fix — timestamp de quando entrou em extracting
          // (usado pelo DocumentCard para mostrar aviso > 60s)
          const extractingSince =
            cardStatus === "extracting" && a.extractingStartedAt
              ? new Date(a.extractingStartedAt).getTime()
              : cardStatus === "extracting"
              ? new Date(a.createdAt).getTime()
              : null;
          return {
            id: a.id,
            filename: a.filename,
            mime: a.mime,
            fileUrl: a.fileUrl,
            status: cardStatus,
            category: a.category,
            fields,
            confidence: typeof extracted.confidence === "number" ? extracted.confidence : null,
            assignment,
            assignmentPersisted: persisted !== null,
            extractingSince,
            error:
              cardStatus === "failed"
                ? a.extractError ?? "Extração falhou — remova ou tente novamente"
                : null,
          };
        });
        setDocs(restored);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };

  }, [token, adapter, scopedSuggest]);

  // Phase F.I-α + F.II polling — enquanto houver cards em status não-final
  // (uploading/extracting/failed), busca GET /attachments a cada 3s e
  // sincroniza com o estado do servidor.
  //
  // F.II: cards em "failed" também são monitorados. Se o servidor reportar
  // status="ready" + extractedData (ex: worker completou após o cliente já
  // ter flipado para failed por outro motivo), o card volta para ready.
  // Defesa em profundidade contra race residual.
  useEffect(() => {
    const hasPending = docs.some(
      (d) => d.status === "extracting" || d.status === "uploading"
    );
    const hasFailedToVerify = docs.some(
      (d) => d.status === "failed" && !d.id.startsWith("tmp-")
    );
    if (!hasPending && !hasFailedToVerify) return;
    let cancelled = false;
    // Pace: pending = 3s; failed-only = 8s (menos pressão no servidor).
    const intervalMs = hasPending ? 3000 : 8000;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/forms/${token}/attachments`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const byId = new Map<string, any>(
          (data.attachments || []).map((a: any) => [a.id, a])
        );
        setDocs((prev) => {
          const snapshot = form.getValues();
          return prev.map((d) => {
            const a = byId.get(d.id);
            if (!a) return d;
            const extracted = a.extractedData || {};
            const fields = extracted.fields || null;
            // Server reporta ready com fields → promove sempre, mesmo se card
            // estava em failed (worker pode ter completado depois).
            if (a.status === "ready" && fields) {
              const siblings: ProcessedDocHint[] = prev
                .filter(
                  (other) =>
                    other.id !== d.id &&
                    other.status === "ready" &&
                    other.fields
                )
                .map((other) => ({
                  category: other.category,
                  fields: other.fields,
                  assignment: other.assignment,
                }));
              // Recomputa o assignment só quando o card estava "failed" (não
              // tinha um bom valor). Prefere o persistido (escolha da parte);
              // senão o heurístico escopado. Card já ok mantém sua escolha.
              const persisted = readPersistedAssignment(extracted);
              const assignment =
                d.status === "failed"
                  ? persisted ?? scopedSuggest(a.category, fields, snapshot, siblings)
                  : d.assignment;
              const assignmentPersisted =
                d.status === "failed" ? persisted !== null : d.assignmentPersisted;
              return {
                ...d,
                status: "ready",
                category: a.category,
                fields,
                confidence:
                  typeof extracted.confidence === "number" ? extracted.confidence : null,
                error: null,
                assignment,
                assignmentPersisted,
                extractingSince: null,
              };
            }
            if (a.status === "failed") {
              return {
                ...d,
                status: "failed",
                error: a.extractError ?? "Extração falhou",
                extractingSince: null,
              };
            }
            // Servidor em "awaiting_user" = OCR on-demand nunca disparada.
            // Se o card local mostra spinner (ex.: estado stale de upload),
            // rebaixa pra "awaiting" — o banner "Extrair com IA" aparece em
            // vez de "Analisando…" eterno.
            if (mapAttachmentStatusToCard(a.status, !!fields) === "awaiting") {
              if (d.status === "extracting" || d.status === "uploading") {
                return { ...d, status: "awaiting", extractingSince: null };
              }
              return d;
            }
            const sinceMs = a.extractingStartedAt
              ? new Date(a.extractingStartedAt).getTime()
              : d.extractingSince ?? new Date(a.createdAt).getTime();
            return { ...d, extractingSince: sinceMs };
          });
        });
      } catch {
        /* retry no próximo tick */
      }
    }, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [docs, token, form, adapter, scopedSuggest]);

  // Fase E — quando uma ficha-resumo fica ready, auto-aplica os dados no form
  // (cria/preenche slots de vendedores/compradores/cônjuges/representantes/
  // imóveis) e re-roda suggestAssignment nos siblings que ainda estão como
  // "outro" — assim docs avulsos pegam o papel correto via match contra a
  // ficha. Idempotente via appliedFichasRef.
  useEffect(() => {
    if (!hydrated) return;
    // Ficha-resumo declara papéis específicos da esteira; adapter sem
    // applyFicha (locação) não tem o recurso — docs ficam em "outro".
    if (!adapter.applyFicha) return;
    const fichaDoc = docs.find(
      (d) =>
        d.status === "ready" &&
        d.category === "ficha_resumo" &&
        d.fields &&
        !appliedFichasRef.current.has(d.id)
    );
    if (!fichaDoc?.fields) return;
    appliedFichasRef.current.add(fichaDoc.id);
    const filled = adapter.applyFicha(
      fichaDoc.fields as FichaResumoData,
      form as never,
      { skipIfDirty: true }
    );
    if (filled > 0) {
      toast.success(
        `Ficha-resumo aplicada — ${filled} campo(s) preenchido(s) automaticamente`
      );
    }
    // Re-roda suggestAssignment pros docs ready ainda em "outro"
    setDocs((prev) => {
      const snapshot = form.getValues();
      const siblings: ProcessedDocHint[] = prev
        .filter((d) => d.status === "ready" && d.fields)
        .map((d) => ({
          category: d.category,
          fields: d.fields,
          assignment: d.assignment,
        }));
      return prev.map((d) => {
        if (d.id === fichaDoc.id) {
          return { ...d, applied: true };
        }
        if (
          d.status === "ready" &&
          d.fields &&
          d.category &&
          d.category !== "outro" &&
          d.assignment.kind === "outro"
        ) {
          const newAssignment = scopedSuggest(
            d.category,
            d.fields,
            snapshot,
            siblings
          );
          if (
            newAssignment.kind !== d.assignment.kind ||
            newAssignment.index !== d.assignment.index
          ) {
            return { ...d, assignment: newAssignment };
          }
        }
        return d;
      });
    });
  }, [docs, form, hydrated, adapter]);

  const updateDoc = useCallback((id: string, patch: Partial<DocumentCardData>) => {
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }, []);

  // Ensure the slot's backing array has at least `index + 1` entries. Used by
  // both auto-grow (adapter.suggest putting a doc on a slot that doesn't exist
  // yet) and the manual "+ Novo" action. Kinds não-array (cônjuge/representante/
  // fiador/imóvel singular) retornam null no adapter — RHF cria o subobjeto no
  // primeiro setValue.
  const ensureSlot = useCallback(
    (kind: DocumentKind, index: number) => {
      if (kind === "outro") return;
      // Guard de sanidade: índice fora de [0,MAX] cresceria o array sem limite
      // (trava a aba). Os callers já saneiam (readPersistedAssignment/suggest),
      // isto é defesa em profundidade contra qualquer índice inesperado.
      if (!Number.isInteger(index) || index < 0 || index > MAX_ASSIGNMENT_INDEX) {
        return;
      }
      const target = adapter.fieldKeyForKind(kind);
      if (!target) return;
      const current = (form.getValues(target.key) as any[] | undefined) ?? [];
      if (current.length > index) return;
      const next = [...current];
      while (next.length <= index) {
        next.push({ ...target.emptyItem });
      }
      form.setValue(target.key, next as never, { shouldDirty: true });
    },
    [form, adapter]
  );

  // Fix 3 — auto-aplica aos campos os docs cujo assignment foi PERSISTIDO pela
  // parte (escolha explícita anterior, ex.: atribuiu+aplicou no link individual).
  // Espelha o auto-apply da ficha-resumo: só reaplicamos o que já foi
  // categorizado, com `skipIfDirty` (nunca sobrescreve digitação manual) e
  // idempotente via `autoAppliedRef`. Assim a OCR feita no link individual
  // reflete nos campos do form principal sem exigir novo clique. Docs sem
  // atribuição explícita seguem exigindo "Aplicar aos campos" (gate H.5).
  useEffect(() => {
    if (!hydrated) return;
    const pending = docs.filter(
      (d) =>
        d.status === "ready" &&
        d.fields &&
        d.assignmentPersisted &&
        d.assignment.kind !== "outro" &&
        !autoAppliedRef.current.has(d.id)
    );
    if (pending.length === 0) return;
    for (const d of pending) {
      autoAppliedRef.current.add(d.id);
      ensureSlot(d.assignment.kind, d.assignment.index);
      adapter.apply(
        { category: d.category, fields: d.fields || {}, confidence: d.confidence ?? 0 },
        d.assignment,
        form as UseFormReturn<Record<string, unknown>>,
        { skipIfDirty: true }
      );
    }
    setDocs((prev) =>
      prev.map((d) =>
        autoAppliedRef.current.has(d.id) ? { ...d, applied: true } : d
      )
    );
  }, [docs, hydrated, form, adapter, ensureSlot]);

  // Fix 4 — link individual: doc de identidade extraído cuja sugestão não
  // casou com ninguém (form da parte vazio ⇒ suggestAssignment cai em "outro"
  // e o gate H.5 desabilitaria o "Aplicar") é do PRÓPRIO participante:
  // atribui ao slot dele, aplica com skipIfDirty (nunca sobrescreve o que a
  // pessoa já digitou) e persiste o assignment — que também habilita o
  // auto-reapply (Fix 3) quando o operador abrir o form principal. Cobre os 3
  // caminhos de chegada (restore, polling e resposta direta do /retry) por
  // observar `docs` em vez de cada um deles.
  useEffect(() => {
    if (!hydrated || !selfAssignment) return;
    const pending = docs.filter(
      (d) =>
        d.status === "ready" &&
        d.fields &&
        isSelfAssignable(d.category, d.fields) &&
        d.assignment.kind === "outro" &&
        !selfAssignedRef.current.has(d.id)
    );
    if (pending.length === 0) return;
    for (const d of pending) {
      selfAssignedRef.current.add(d.id);
      // Entra no set do Fix 3 também: o assignment agora é persistido e o
      // effect de auto-reapply não deve reaplicar em cima.
      autoAppliedRef.current.add(d.id);
      ensureSlot(selfAssignment.kind, selfAssignment.index);
      adapter.apply(
        { category: d.category, fields: d.fields || {}, confidence: d.confidence ?? 0 },
        selfAssignment,
        form as UseFormReturn<Record<string, unknown>>,
        { skipIfDirty: true }
      );
      // Persistência é o que faz o doc refletir no form principal (Fix 3) —
      // como aqui não há clique do usuário pra "tentar de novo", uma falha
      // transitória de rede ganha 1 retry antes de desistir.
      const persistAssignment = () =>
        fetch(`/api/forms/${token}/attachments?id=${d.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignment: selfAssignment }),
        });
      persistAssignment()
        .then((res) => {
          if (!res.ok) throw new Error(`assignment PATCH ${res.status}`);
        })
        .catch(() => {
          setTimeout(() => {
            persistAssignment().catch(() => {
              /* non-blocking — o card local já reflete a atribuição */
            });
          }, 3000);
        });
    }
    setDocs((prev) =>
      prev.map((d) =>
        selfAssignedRef.current.has(d.id) && d.assignment.kind === "outro"
          ? { ...d, assignment: selfAssignment, assignmentPersisted: true, applied: true }
          : d
      )
    );
    toast.success(
      `${pending.length} documento(s) aplicado(s) automaticamente aos seus dados`
    );
  }, [docs, hydrated, selfAssignment, form, adapter, ensureSlot, token]);

  // Applies the OCR result for a single attachment to its card. Runs inside
  // a setDocs callback so parallel calls see the freshest state — prevents
  // stale-siblings bugs when multiple docs resolve out of order.
  const applyExtractResult = useCallback(
    (
      attachmentId: string,
      category: string | null,
      fields: Record<string, unknown>,
      confidence: number | null
    ) => {
      setDocs((prev) => {
        const snapshot = form.getValues();
        const siblings: ProcessedDocHint[] = prev
          .filter((d) => d.id !== attachmentId && d.status === "ready" && d.fields)
          .map((d) => ({
            category: d.category,
            fields: d.fields,
            assignment: d.assignment,
          }));
        const assignment = scopedSuggest(category, fields, snapshot, siblings);
        ensureSlot(assignment.kind, assignment.index);
        return prev.map((d) =>
          d.id === attachmentId
            ? {
                ...d,
                status: "ready",
                category,
                fields,
                confidence,
                assignment,
                // Sugestão heurística fresca — não é escolha persistida da parte,
                // então não entra na auto-aplicação (Fix 3); segue o "Aplicar".
                assignmentPersisted: false,
              }
            : d
        );
      });
    },
    [form, ensureSlot, scopedSuggest]
  );

  // Single-doc retry — usa novo endpoint /retry que libera lock e reenfileira.
  // O polling pega o resultado depois (via useEffect acima).
  const runExtract = useCallback(
    async (doc: DocumentCardData) => {
      updateDoc(doc.id, {
        status: "extracting",
        error: null,
        extractingSince: Date.now(),
      });
      try {
        const res = await fetch(`/api/forms/${token}/attachments/${doc.id}/retry`, {
          method: "POST",
        });
        const data = await res.json();
        if (!res.ok) {
          updateDoc(doc.id, {
            status: "failed",
            error: data.error || "Falha ao reenviar para fila",
          });
          return;
        }
        // Worker vai processar em background. Polling do useEffect pega o
        // resultado quando ficar ready ou failed. Legado: se o endpoint
        // responder com extractedData direto (cached), aplica imediato.
        const extracted = data.extractedData || {};
        const fields = extracted.fields || {};
        const confidence =
          typeof extracted.confidence === "number" ? extracted.confidence : null;
        if (fields && Object.keys(fields).length > 0) {
          applyExtractResult(doc.id, data.category, fields, confidence);
        }
      } catch (err) {
        updateDoc(doc.id, {
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [token, updateDoc, applyExtractResult]
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      if (arr.length === 0) return;

      // Filter + dedupe + size validation up-front. Each accepted file gets
      // a temporary card and runs its full pipeline (resize → upload → extract)
      // through the pLimit throttle so multiple files run in parallel without
      // blowing up Gemini concurrency or the browser's per-origin fetch limit.
      const validFiles: Array<{ rawFile: File; tempId: string }> = [];
      for (const rawFile of arr) {
        if (!ACCEPTED_MIMES.includes(rawFile.type)) {
          toast.error(`Tipo não suportado: ${rawFile.name}`);
          continue;
        }
        if (rawFile.size > MAX_BYTES) {
          toast.error(`${rawFile.name} excede 20 MB`);
          continue;
        }
        const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const tempDoc: DocumentCardData = {
          id: tempId,
          filename: rawFile.name,
          mime: rawFile.type,
          fileUrl: URL.createObjectURL(rawFile),
          status: "uploading",
          category: null,
          fields: null,
          confidence: null,
          assignment: { kind: "outro", index: 0 },
        };
        setDocs((prev) => [...prev, tempDoc]);
        validFiles.push({ rawFile, tempId });
      }

      if (validFiles.length === 0) return;
      if (validFiles.length > 1) {
        toast.info(`Enviando ${validFiles.length} documentos…`);
      }

      // Pipeline (OCR on-demand):
      //   1. Upload paralelo (até 4 simultâneos) para Blob storage.
      //   2. Servidor cria FormAttachment com status="awaiting_user" e NÃO
      //      enfileira OCR — cache-hit por SHA-256 responde direto "ready".
      //   3. Card fica em "awaiting" com o banner "Extrair com IA"; o clique
      //      chama /retry, que enfileira o worker, e o polling (useEffect
      //      acima) pega o resultado quando ficar "ready" ou "failed".
      const uploadLimit = pLimit(UPLOAD_CONCURRENCY);

      type UploadOutcome = { doc: DocumentCardData; cached: boolean } | null;

      const doUpload = async (
        rawFile: File,
        tempId: string
      ): Promise<UploadOutcome> => {
        try {
          const file = IMAGE_MIMES.includes(rawFile.type)
            ? await resizeImage(rawFile, RESIZE_MAX_SIDE)
            : rawFile;

          // Upload DIRETO pro Blob: o arquivo não passa pelo corpo da função,
          // que era o teto real de ~4.5MB da Vercel (a mensagem de "10 MB" era
          // otimista — um PDF de 6MB morria com 413 opaco antes de chegar na
          // validação). `/blob-upload` só emite o token; `/finalize` cria a
          // linha e é onde a checagem de magic bytes passou a rodar, agora
          // sobre o objeto baixado do storage.
          // Pathname sem o token no caminho: a URL do Blob é pública e
          // permanente, e o token do formulário é segredo. `addRandomSuffix`
          // no handshake garante unicidade.
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          const blob = await upload(
            `form-attachments/${Date.now()}-${safeName}`,
            file,
            {
              access: "public",
              handleUploadUrl: `/api/forms/${token}/attachments/blob-upload`,
              contentType: file.type,
            }
          );

          const uploadRes = await fetch(
            `/api/forms/${token}/attachments/finalize`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                url: blob.url,
                filename: file.name,
                mime: file.type,
              }),
            }
          );
          const uploadData = await uploadRes.json();
          if (!uploadRes.ok) {
            setDocs((prev) =>
              prev.map((d) =>
                d.id === tempId
                  ? { ...d, status: "failed", error: uploadData.error || "Falha no upload" }
                  : d
              )
            );
            return null;
          }

          // Upload route pre-warms the content-hash cache: if the same file
          // content has already been OCRed in this org, the server copies the
          // cached result onto the new attachment and returns { cached: true,
          // category, extractedData }. We can skip the OCR call entirely and
          // apply the result straight to the card.
          if (uploadData.cached && uploadData.extractedData) {
            const fields =
              (uploadData.extractedData.fields as Record<string, unknown>) || {};
            const confidence =
              typeof uploadData.extractedData.confidence === "number"
                ? uploadData.extractedData.confidence
                : null;
            // Swap temp id for persisted id first so applyExtractResult finds it.
            setDocs((prev) =>
              prev.map((d) =>
                d.id === tempId
                  ? {
                      ...d,
                      id: uploadData.id,
                      fileUrl: uploadData.fileUrl,
                    }
                  : d
              )
            );
            applyExtractResult(
              uploadData.id,
              uploadData.category ?? null,
              fields,
              confidence
            );
            return {
              doc: {
                id: uploadData.id,
                filename: rawFile.name,
                mime: rawFile.type,
                fileUrl: uploadData.fileUrl,
                status: "ready",
                category: uploadData.category ?? null,
                fields,
                confidence,
                assignment: { kind: "outro", index: 0 },
              },
              cached: true,
            };
          }

          // Promote temp card to persisted id. Status vem da RESPOSTA do
          // servidor via mapeamento canônico — normalmente "awaiting_user"
          // → "awaiting" (banner "Extrair com IA"). NÃO assumir "extracting":
          // o servidor não enfileira OCR no upload, e um spinner aqui vira
          // "Analisando…" eterno (bug do teste RE/MAX Trio, 2026-07-15).
          const cardStatus = mapAttachmentStatusToCard(
            uploadData.status,
            false
          );
          setDocs((prev) =>
            prev.map((d) =>
              d.id === tempId
                ? {
                    ...d,
                    id: uploadData.id,
                    fileUrl: uploadData.fileUrl,
                    status: cardStatus,
                  }
                : d
            )
          );

          return {
            doc: {
              id: uploadData.id,
              filename: rawFile.name,
              mime: rawFile.type,
              fileUrl: uploadData.fileUrl,
              status: cardStatus,
              category: null,
              fields: null,
              confidence: null,
              assignment: { kind: "outro", index: 0 },
            },
            cached: false,
          };
        } catch (err) {
          setDocs((prev) =>
            prev.map((d) =>
              d.id === tempId
                ? {
                    ...d,
                    status: "failed",
                    error: err instanceof Error ? err.message : String(err),
                  }
                : d
            )
          );
          return null;
        }
      };

      // Apenas dispara os uploads em paralelo. O servidor (POST /attachments)
      // já enfileira o OCR no worker; o useEffect de polling pega o resultado
      // assim que ficar ready/failed no DB.
      const tasks = validFiles.map(({ rawFile, tempId }) =>
        uploadLimit(() => doUpload(rawFile, tempId))
      );

      await Promise.allSettled(tasks);
    },
    [docs.length, token]
  );

  const handleAssignmentChange = useCallback(
    (id: string, assignmentValue: string) => {
      const [rawKind, rawIdx] = assignmentValue.split(":");
      const kind = rawKind as DocumentKind;
      let index: number;
      if (rawIdx === "new") {
        // "+ Novo X" — append a fresh slot to the form array and assign here.
        // Só kinds com array no adapter suportam "novo"; subobjetos (cônjuge/
        // representante/fiador) derivam do papel da parte pai.
        const target = adapter.fieldKeyForKind(kind);
        if (!target) return;
        const current = (form.getValues(target.key) as any[] | undefined) ?? [];
        index = current.length;
        ensureSlot(kind, index);
        toast.success(`${adapter.kindLabel(kind)} ${index + 1} criado`);
      } else {
        index = Number(rawIdx) || 0;
        ensureSlot(kind, index);
      }
      // Troca manual tira o doc do trilho de auto-aplicação persistida (Fix 3):
      // a escolha agora é do operador na sessão atual, aplicada via "Aplicar aos
      // campos". `assignmentPersisted:false` impede o effect de reaplicar sozinho.
      autoAppliedRef.current.delete(id);
      updateDoc(id, {
        assignment: { kind, index },
        applied: false,
        assignmentPersisted: false,
      });
    },
    [updateDoc, form, ensureSlot, adapter]
  );

  const handleRemove = useCallback(
    async (id: string) => {
      setDocs((prev) => prev.filter((d) => d.id !== id));
      if (!id.startsWith("tmp-")) {
        try {
          await fetch(`/api/forms/${token}/attachments?id=${id}`, { method: "DELETE" });
        } catch {
          /* ignore */
        }
      }
    },
    [token]
  );

  const handleRetry = useCallback(
    (id: string) => {
      const doc = docs.find((d) => d.id === id);
      if (doc) runExtract(doc);
    },
    [docs, runExtract]
  );

  const handleApply = useCallback(async () => {
    const readyDocs = docs.filter(
      (d) => d.status === "ready" && d.fields && d.assignment.kind !== "outro"
    );
    if (readyDocs.length === 0) {
      toast.info("Nenhum documento pronto para aplicar");
      return;
    }
    let totalFields = 0;
    for (const doc of readyDocs) {
      const count = adapter.apply(
        { category: doc.category, fields: doc.fields || {}, confidence: doc.confidence ?? 0 },
        doc.assignment,
        form as UseFormReturn<Record<string, unknown>>,
        { skipIfDirty: true }
      );
      totalFields += count;
      updateDoc(doc.id, { applied: true });

      fetch(`/api/forms/${token}/attachments?id=${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignment: doc.assignment }),
      }).catch(() => {
        /* non-blocking */
      });
    }
    toast.success(
      `${readyDocs.length} documento(s) aplicado(s) — ${totalFields} campo(s) preenchido(s)`
    );
  }, [docs, form, token, updateDoc, adapter]);

  const snapshot = form.getValues();
  // Fix 2: nos links por parte, só oferece slots do papel (allowedTopKeys).
  const assignmentOptions = filterAssignmentOptionsByScope(
    adapter.buildOptions(snapshot, docs),
    allowedTopKeys,
    adapter.topKeyForKind
  );
  const readyCount = docs.filter((d) => d.status === "ready").length;
  // Only block "Aplicar aos campos" while files are still UPLOADING. Extractions
  // can take up to 60s per file (Gemini) and one failed extraction should not
  // block applying the successful ones.
  const hasUploading = docs.some((d) => d.status === "uploading");
  const hasPending = docs.some((d) => d.status === "uploading" || d.status === "extracting");
  // H.5 (Phase H, 2026-04-18) — bloquear "Aplicar" se houver doc de pessoa
  // ainda sem atribuição explícita (kind === "outro"). Força o usuário a
  // escolher vendedor/comprador/diligenciado no dropdown antes de aplicar,
  // evitando troca comprador↔vendedor do fallback antigo.
  const unassignedPersonDocs = docs.filter(
    (d) =>
      d.status === "ready" &&
      d.fields &&
      d.category &&
      d.category !== "outro" &&
      d.category !== "matricula" &&
      d.category !== "iptu" &&
      d.category !== "escritura" &&
      d.assignment.kind === "outro"
  );
  const needsExplicitAssignment = unassignedPersonDocs.length > 0;

  return (
    <div className="space-y-4">
      <Card className="border-dashed">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Sparkles className="h-4 w-4 text-primary" />
            Anexe os documentos (opcional)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Envie RG, CPF, comprovante de residência, matrícula, IPTU, escritura ou procuração.
            O sistema identifica cada documento e preenche automaticamente os campos do formulário.
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              handleFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-8 transition-colors ${
              dragging
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-muted/30"
            }`}
          >
            <Upload className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              Clique ou arraste arquivos aqui
            </p>
            <p className="text-xs text-muted-foreground">
              JPG, PNG, WebP ou PDF — até 20 MB por arquivo
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPTED_MIMES.join(",")}
              className="hidden"
              onChange={(e) => {
                if (e.target.files) handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        </CardContent>
      </Card>

      {docs.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm text-muted-foreground">
              {readyCount} de {docs.length} prontos
              {hasPending && ` · ${docs.filter((d) => d.status === "uploading" || d.status === "extracting").length} processando`}
              {docs.some((d) => d.status === "awaiting") &&
                ` · ${docs.filter((d) => d.status === "awaiting").length} aguardando extração`}
              {docs.some((d) => d.status === "failed") &&
                ` · ${docs.filter((d) => d.status === "failed").length} com falha`}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              {docs.some((d) => d.status === "awaiting") && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const awaiting = docs.filter((d) => d.status === "awaiting");
                    awaiting.forEach((d) => handleRetry(d.id));
                    toast.info(
                      `Extraindo ${awaiting.length} documento(s) com IA…`,
                    );
                  }}
                  title="Dispara a IA Gemini em todos os documentos aguardando extração. Consome tokens — só clique nos docs que você quer auto-preencher."
                >
                  <Sparkles className="h-3.5 w-3.5 mr-1" />
                  Extrair todos com IA ({docs.filter((d) => d.status === "awaiting").length})
                </Button>
              )}
              <Button
                type="button"
                onClick={handleApply}
                disabled={readyCount === 0 || hasUploading || needsExplicitAssignment}
                size="sm"
                title={
                  needsExplicitAssignment
                    ? `${unassignedPersonDocs.length} documento(s) sem atribuição — escolha vendedor/comprador no dropdown antes de aplicar`
                    : undefined
                }
              >
                Aplicar aos campos ({readyCount})
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {docs.map((doc) => (
              <DocumentCard
                key={doc.id}
                doc={doc}
                assignmentOptions={assignmentOptions}
                onAssignmentChange={handleAssignmentChange}
                // `undefined` esconde o X (DocumentCard renderiza só com
                // onRemove). Membro remove qualquer um; num link por parte o
                // GET já filtra pros documentos DAQUELA parte, então remover ali
                // é sempre o próprio upload. Cliente no link principal não
                // remove — o servidor devolve 403 de qualquer forma.
                onRemove={
                  viewerIsMember || allowedTopKeys ? handleRemove : undefined
                }
                onRetry={handleRetry}
                onExtract={handleRetry}
              />
            ))}
          </div>
        </div>
      )}

      {hydrated && docs.length === 0 && (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          Sem documentos anexados. Você pode pular esta etapa e preencher manualmente.
        </p>
      )}
    </div>
  );
}
