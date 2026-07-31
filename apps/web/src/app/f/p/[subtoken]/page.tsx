import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { resolveFormRequiredFields } from "@/lib/forms/required-snapshot";
import {
  resolveParticipantToken,
  type ParticipantRole,
} from "@/lib/forms/participant-token";
import { filterDataJsonByPaths } from "@/lib/forms/role-paths";
import { resolveParticipantScope } from "@/lib/forms/participant-scope";
import { canAccessForm } from "@/lib/forms/form-gate";
import { listGarantiaOptions } from "@/lib/forms/garantia-option-repo";
import { isLocacaoSchemaType } from "@/lib/forms/validation-locacao";
import { FormClosedNotice } from "@/components/forms/FormClosedNotice";
import { SubtokenFormClient } from "./form-client";
import { TerceiroFormClient } from "./terceiro-client";

export default async function PublicParticipantFormPage({
  params,
}: {
  params: { subtoken: string };
}) {
  const resolved = await resolveParticipantToken(params.subtoken);
  if (!resolved.ok) return notFound();

  const participant = await prisma.salesFormParticipant.findUniqueOrThrow({
    where: { id: resolved.participant.id },
    include: { form: true },
  });

  // O form-pai fechou: o link por parte para junto. (Diferente do
  // `participant.completedAt`, que só diz que ESTA parte terminou e continua
  // permitindo revisão enquanto o form estiver aberto.)
  if (!(await canAccessForm(participant.form))) {
    return <FormClosedNotice />;
  }

  const scope = await resolveParticipantScope(
    participant.role,
    participant.form.orgId,
  );
  const fullData = (participant.form.dataJson ?? {}) as Record<string, unknown>;
  // Filtro por PATHS: nos 5 papéis nativos o escopo é top-level e o resultado é
  // idêntico ao `filterDataJsonByRole` de sempre; no terceiro, recorta só
  // `terceiros.<slug>` — outra categoria do mesmo formulário fica invisível.
  const filtered = filterDataJsonByPaths(fullData, scope.paths);

  // Link de terceiro: tela própria (um passo só, montada das field defs da
  // categoria) em vez do wizard. Categoria removida/desativada depois do envio
  // do link → o link deixa de servir, como um form fechado.
  if (scope.slug) {
    if (!scope.category || !scope.category.active) return <FormClosedNotice />;
    return (
      <TerceiroFormClient
        subtoken={params.subtoken}
        category={{
          slug: scope.category.slug,
          label: scope.category.label,
          description: scope.category.description,
          fields: scope.category.fields,
        }}
        partyIndex={participant.partyIndex}
        initialData={filtered}
        formTitle={participant.form.title}
        completedAt={participant.completedAt?.toISOString() ?? null}
        locked={Boolean(participant.form.lockedAt)}
      />
    );
  }

  // Required fields vêm do server (preset da org por MÓDULO — locação pelo
  // snapshot do próprio form), mas só os steps visíveis pro role são
  // renderizados: paths fora desses steps são ignorados pelo wizard.
  const requiredFieldsByStep = await resolveFormRequiredFields(participant.form);

  // Catálogo de garantias (link do fiador enxerga a etapa Garantia). Server-side
  // pelo mesmo motivo do form principal: o link é anônimo.
  const garantiaOptions = isLocacaoSchemaType(participant.form.schemaType)
    ? await listGarantiaOptions(participant.form.orgId, { activeOnly: true })
    : undefined;

  return (
    <SubtokenFormClient
      subtoken={params.subtoken}
      role={participant.role as ParticipantRole}
      schemaType={participant.form.schemaType}
      initialData={filtered}
      requiredFieldsByStep={requiredFieldsByStep}
      garantiaOptions={garantiaOptions}
      stepIndexes={Array.from(scope.stepIndexes)}
      pathScope={Array.from(scope.paths)}
      partyIndex={participant.partyIndex}
      formTitle={participant.form.title}
      completedAt={participant.completedAt?.toISOString() ?? null}
      locked={Boolean(participant.form.lockedAt)}
    />
  );
}
