import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resolveParticipantToken } from "@/lib/forms/participant-token";
import {
  filterDataJsonByPaths,
  narrowIncomingToPaths,
} from "@/lib/forms/role-paths";
import {
  mergeSalesFormDataJson,
  FormNotFoundError,
} from "@/lib/forms/atomic-merge";
import { deepMergeAtPaths } from "@/lib/forms/dataJson-merge";
import { resolveParticipantScope } from "@/lib/forms/participant-scope";
import { requiredPathsForCategory } from "@/lib/forms/participant-category";
import {
  resolveFormRequiredFields,
  requiredPathsForRoleScope,
} from "@/lib/forms/required-snapshot";
import { findMissingRequired, getByPath } from "@/lib/forms/party-required";
import { PARTY_ARRAY_KEYS } from "@/lib/forms/blank-party";
import { syncDealClientName } from "@/lib/forms/sync-deal-client-name";
import { formClosedResponse } from "@/lib/forms/form-gate";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { waitUntil } from "@vercel/functions";
import { emitNotification } from "@/lib/notifications/emit";

const ROLE_LABELS: Record<string, string> = {
  vendedor: "Vendedor",
  comprador: "Comprador",
  locador: "Locador",
  locatario: "Locatário",
  fiador: "Fiador",
};

/**
 * GET /api/forms/participant/[subtoken]
 * Público — sem session. Valida JWT, retorna dataJson filtrado pelo role.
 *
 * O token decodificado precisa BATER com `SalesFormParticipant.token` no DB
 * (canônico). Isso permite que "regenerar link" invalide o JWT antigo mesmo
 * que a assinatura ainda seja válida.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { subtoken: string } },
) {
  const resolved = await resolveParticipantToken(params.subtoken);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: 401 });
  }

  const participant = await prisma.salesFormParticipant.findUniqueOrThrow({
    where: { id: resolved.participant.id },
    include: { form: true },
  });

  // Form-pai já enviado: o subtoken também para de servir dados. Mesmo gate do
  // token principal — senão o link por parte vira a porta dos fundos.
  const closed = await formClosedResponse(participant.form);
  if (closed) return closed;

  // lastAccessAt best-effort — não bloqueia leitura.
  prisma.salesFormParticipant
    .update({
      where: { id: participant.id },
      data: { lastAccessAt: new Date() },
    })
    .catch(() => {});

  const scope = await resolveParticipantScope(
    participant.role,
    participant.form.orgId,
  );
  const fullData = (participant.form.dataJson ?? {}) as Record<string, unknown>;
  // Filtro por PATHS (não só top-level): num link de terceiro o participante
  // recebe apenas `terceiros.<slug>`, nunca as respostas de outra categoria.
  const filtered = filterDataJsonByPaths(fullData, scope.paths);

  return NextResponse.json({
    role: scope.role,
    partyIndex: participant.partyIndex,
    formTitle: participant.form.title,
    formStatus: participant.form.status,
    completedAt: participant.completedAt?.toISOString() ?? null,
    // Travamento do form: cliente do subtoken renderiza somente-leitura.
    lockedAt: participant.form.lockedAt
      ? participant.form.lockedAt.toISOString()
      : null,
    dataJson: filtered,
    allowedTopKeys: scope.topKeys,
    pathScope: scope.paths,
    // Só no link de terceiro: as field defs que a tela renderiza.
    category: scope.category
      ? {
          slug: scope.category.slug,
          label: scope.category.label,
          description: scope.category.description,
          fields: scope.category.fields,
          active: scope.category.active,
        }
      : null,
  }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * PATCH /api/forms/participant/[subtoken]
 * Público — sem session. Auto-save do subtoken. Allowlist enforced via
 * `mergeSalesFormDataJson({ allowedTopKeys: scope.topKeys })` — merge atômico
 * sob row lock (ver lib/forms/atomic-merge.ts). Quando o escopo é aninhado
 * (link de terceiro, `terceiros.<slug>`), o payload passa antes por
 * `narrowIncomingToPaths`; papel nativo segue o caminho de sempre.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { subtoken: string } },
) {
  const resolved = await resolveParticipantToken(params.subtoken);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: 401 });
  }

  const participant = await prisma.salesFormParticipant.findUniqueOrThrow({
    where: { id: resolved.participant.id },
    include: { form: true },
  });

  // Guard de travamento: form travado congela também os subtokens por parte.
  if (participant.form.lockedAt) {
    return NextResponse.json(
      { error: "Formulário travado — não aceita mais alterações", reason: "form_locked" },
      { status: 403 },
    );
  }

  const closed = await formClosedResponse(participant.form);
  if (closed) return closed;

  const body = await req.json().catch(() => ({}));
  const scope = await resolveParticipantScope(
    participant.role,
    participant.form.orgId,
  );
  const role = scope.role;
  const rawIncoming = (body.dataJson ?? {}) as Record<string, unknown>;

  // Link de terceiro cuja categoria foi apagada/desativada: sem definição não
  // há campo válido pra gravar, então o link congela (403) em vez de aceitar
  // um payload que ninguém consegue mais interpretar.
  if (scope.slug && (!scope.category || !scope.category.active)) {
    return NextResponse.json(
      {
        error: "Este link não está mais disponível — fale com a imobiliária.",
        reason: "category_unavailable",
      },
      { status: 403 },
    );
  }

  // Escopo ANINHADO (terceiro) precisa ser recortado antes do merge: o
  // `allowedTopKeys` de `deepMergeAtPaths` só sabe chave de primeiro nível, e
  // liberar `terceiros` inteiro deixaria uma categoria escrever na subárvore de
  // outra. Papel nativo NÃO passa por aqui — segue exatamente o caminho antigo.
  const narrowed = scope.nested
    ? narrowIncomingToPaths(rawIncoming, scope.paths)
    : { incoming: rawIncoming, rejectedPaths: [] as string[] };
  const incoming = narrowed.incoming;

  // Status do subtoken: "completo" só se body explicitamente pediu.
  // Form principal só transiciona pra "completo" via token principal —
  // subtoken faz "completedAt" apenas no próprio participant.
  const markCompleted = body.markCompleted === true;

  // Obrigatoriedade configurada pela org, no ESCOPO DESTA PARTE. Espelha o
  // bloqueio do finalize do token principal de locação (422 antes de gravar
  // qualquer coisa). Só LOCAÇÃO: em venda o "concluir parte" nunca bloqueou e
  // mudar isso agora endureceria links já em circulação.
  //
  // TERCEIRO é a exceção: a obrigatoriedade não vem de preset nenhum, e sim
  // das field defs `required: true` da categoria — e vale nas DUAS esteiras,
  // porque a categoria (e o link) nasceram junto com esta regra.
  if (markCompleted && (scope.slug || participant.form.schemaType?.startsWith("locacao"))) {
    const scoped = scope.slug
      ? requiredPathsForCategory(
          scope.slug,
          participant.partyIndex,
          scope.category?.fields ?? [],
        )
      : requiredPathsForRoleScope(
          await resolveFormRequiredFields(participant.form),
          scope.stepIndexes,
          scope.topKeys,
        );
    if (scoped.length > 0) {
      const preview = deepMergeAtPaths(
        structuredClone(
          (participant.form.dataJson ?? {}) as Record<string, unknown>,
        ),
        incoming,
        scope.topKeys,
      ).merged;
      const missingRequired = findMissingRequired(scoped, (path) =>
        getByPath(preview, path),
      );
      if (missingRequired.length > 0) {
        return NextResponse.json(
          {
            error: "Campos obrigatórios não preenchidos",
            reason: "required_fields_missing",
            missingRequired,
          },
          { status: 422 },
        );
      }
    }
  }

  // Merge atômico: releitura do dataJson sob FOR UPDATE dentro da transação —
  // o save do participante nunca regride edições concorrentes do token
  // principal (ou de outro subtoken) feitas depois da leitura acima.
  const completedNow =
    markCompleted && !participant.completedAt ? new Date() : null;
  let mergeOutcome;
  try {
    mergeOutcome = await mergeSalesFormDataJson({
      where: { id: participant.formId },
      incoming,
      allowedTopKeys: scope.topKeys,
      // Um subtoken recém-aberto também ecoa a própria fatia template-vazia
      // no mount — o guard impede que isso apague o que o operador (ou outra
      // sessão da mesma parte) já preencheu naquela chave.
      protectBlankPartyArrays: scope.topKeys.filter((k) =>
        (PARTY_ARRAY_KEYS as readonly string[]).includes(k),
      ),
      also: async (tx) => {
        await tx.salesFormParticipant.update({
          where: { id: participant.id },
          data: {
            lastAccessAt: new Date(),
            ...(completedNow ? { completedAt: completedNow } : {}),
          },
        });
      },
    });
  } catch (error) {
    // Form deletado entre o findUniqueOrThrow acima e o SELECT FOR UPDATE
    // (delete do deal com ?deleteForm=true durante o auto-save da parte).
    // 404 explícito — 500 faria o use-auto-save re-tentar pra sempre.
    if (error instanceof FormNotFoundError) {
      return NextResponse.json({ error: "Form not found" }, { status: 404 });
    }
    throw error;
  }

  // Rejeições do recorte de escopo aninhado (terceiro) entram no MESMO relatório
  // das rejeitadas pelo merge — pro operador ver "o cliente mandou fora do escopo"
  // num lugar só, independente de qual camada barrou.
  const rejectedPaths = [...narrowed.rejectedPaths, ...mergeOutcome.rejectedPaths];

  if (rejectedPaths.length > 0) {
    // Log + audit (não bloqueia save — bug de UI não pode quebrar fluxo).
    console.warn("[participant PATCH] rejected paths", {
      participantId: participant.id,
      role,
      rejectedPaths,
    });
    audit(
      extractAuditContextFromRequest(req, participant.form.orgId, null),
      {
        action: "PARTICIPANT_PATCH_REJECTED_PATH",
        result: "DENIED",
        resourceType: "SalesFormParticipant",
        resource: participant.id,
        metadata: {
          role,
          rejectedPaths,
        },
      },
    );
  }

  if (mergeOutcome.skippedBlankArrayKeys.length > 0) {
    console.warn("[participant PATCH] blank party arrays skipped", {
      participantId: participant.id,
      role,
      skippedKeys: mergeOutcome.skippedBlankArrayKeys,
    });
    audit(
      extractAuditContextFromRequest(req, participant.form.orgId, null),
      {
        action: "FORM_PATCH_BLANK_ARRAY_SKIPPED",
        result: "DENIED",
        resourceType: "SalesFormParticipant",
        resource: participant.id,
        metadata: {
          role,
          skippedKeys: mergeOutcome.skippedBlankArrayKeys,
        },
      },
    );
  }

  // Comprador/locatário titular pode ser preenchido EXCLUSIVAMENTE por este
  // link por parte — sem o sync aqui, o card no kanban ficava sem nome até
  // alguém salvar pelo token principal ou gerar o contrato. finalData é o
  // estado realmente gravado (pós-merge atômico sob lock).
  if (body.dataJson) {
    await syncDealClientName({
      formId: participant.formId,
      schemaType: participant.form.schemaType,
      mergedData: mergeOutcome.finalData as Record<string, unknown>,
    });
  }


  if (markCompleted && !participant.completedAt) {
    audit(
      extractAuditContextFromRequest(req, participant.form.orgId, null),
      {
        action: "PARTICIPANT_COMPLETED",
        result: "SUCCESS",
        resourceType: "SalesFormParticipant",
        resource: participant.id,
        metadata: { role, formId: participant.formId },
      },
    );

    // Sino: a parte terminou de preencher — operador não precisa ficar
    // conferindo o form. batchId=participant.id deduplica re-submissões.
    // waitUntil obrigatório: `void promise` após o response é cancelado na
    // Vercel (feedback_vercel_fire_and_forget).
    const isLocacao = participant.form.schemaType?.startsWith("locacao");
    // Terceiro não tem rótulo fixo — o nome é o label da categoria da org.
    const roleLabel = scope.category?.label ?? ROLE_LABELS[role] ?? role;
    waitUntil(emitNotification({
      orgId: participant.form.orgId,
      type: "participant_completed",
      title: `${roleLabel} preencheu os dados`,
      body: `"${participant.form.title ?? "Formulário"}" — a parte ${
        roleLabel.toLowerCase()
      } concluiu a qualificação pelo link exclusivo.`,
      linkUrl: isLocacao ? undefined : `/forms/${participant.formId}/share`,
      metadata: { formId: participant.formId, participantId: participant.id, role },
      batchId: participant.id,
    }));
  }

  return NextResponse.json({
    role,
    completedAt:
      (participant.completedAt ?? completedNow)?.toISOString() ?? null,
    rejectedPaths,
    skippedBlankArrayKeys: mergeOutcome.skippedBlankArrayKeys,
  });
}
