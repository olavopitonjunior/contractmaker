import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { resolveFormRequiredFields } from "@/lib/forms/required-snapshot";
import {
  resolveParticipantToken,
  type ParticipantRole,
} from "@/lib/forms/participant-token";
import {
  ROLE_PATHS,
  filterDataJsonByRole,
} from "@/lib/forms/role-paths";
import { ROLE_STEP_INDEXES } from "@/lib/forms/role-steps";
import { canAccessForm } from "@/lib/forms/form-gate";
import { FormClosedNotice } from "@/components/forms/FormClosedNotice";
import { SubtokenFormClient } from "./form-client";

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

  const role = participant.role as ParticipantRole;
  const fullData = (participant.form.dataJson ?? {}) as Record<string, unknown>;
  const filtered = filterDataJsonByRole(fullData, role);

  // Required fields vêm do server (preset da org por MÓDULO — locação pelo
  // snapshot do próprio form), mas só os steps visíveis pro role são
  // renderizados: paths fora desses steps são ignorados pelo wizard.
  const requiredFieldsByStep = await resolveFormRequiredFields(participant.form);

  return (
    <SubtokenFormClient
      subtoken={params.subtoken}
      role={role}
      schemaType={participant.form.schemaType}
      initialData={filtered}
      requiredFieldsByStep={requiredFieldsByStep}
      stepIndexes={Array.from(ROLE_STEP_INDEXES[role])}
      pathScope={Array.from(ROLE_PATHS[role])}
      partyIndex={participant.partyIndex}
      formTitle={participant.form.title}
      completedAt={participant.completedAt?.toISOString() ?? null}
      locked={Boolean(participant.form.lockedAt)}
    />
  );
}
