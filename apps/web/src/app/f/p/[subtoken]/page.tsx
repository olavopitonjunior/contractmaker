import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { resolveAllRequiredFields } from "@/lib/forms/presets";
import {
  verifyParticipantToken,
  type ParticipantRole,
} from "@/lib/forms/participant-token";
import {
  ROLE_PATHS,
  filterDataJsonByRole,
} from "@/lib/forms/role-paths";
import { ROLE_STEP_INDEXES } from "@/lib/forms/role-steps";
import { SubtokenFormClient } from "./form-client";

export default async function PublicParticipantFormPage({
  params,
}: {
  params: { subtoken: string };
}) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    // Sem AUTH_SECRET o JWT não pode ser verificado — devolve notFound em
    // vez de 500 pra não vazar info de config.
    return notFound();
  }

  const verify = verifyParticipantToken(params.subtoken, secret);
  if (!verify.ok) return notFound();

  const participant = await prisma.salesFormParticipant.findFirst({
    where: {
      id: verify.payload.participantId,
      token: params.subtoken,
    },
    include: { form: true },
  });
  if (!participant) return notFound();

  const role = participant.role as ParticipantRole;
  const fullData = (participant.form.dataJson ?? {}) as Record<string, unknown>;
  const filtered = filterDataJsonByRole(fullData, role);

  // Locação usa o LocacaoFormWizard (validação 100% client/finalize) — sem
  // preset de required fields da org.
  const isLocacao = participant.form.schemaType?.startsWith("locacao") ?? false;

  // Required fields ainda vem do server pra preset da org, mas só os steps
  // visíveis pro role serão renderizados — paths fora desses steps são
  // ignorados pelo validateAndNavigate dentro do wizard.
  const orgFormSettings = isLocacao
    ? null
    : await prisma.orgFormSettings.findUnique({
        where: { orgId: participant.form.orgId },
      });
  const requiredFieldsByStep = isLocacao
    ? []
    : resolveAllRequiredFields(orgFormSettings).map((paths) => Array.from(paths));

  return (
    <SubtokenFormClient
      subtoken={params.subtoken}
      role={role}
      schemaType={participant.form.schemaType}
      initialData={filtered}
      requiredFieldsByStep={requiredFieldsByStep}
      stepIndexes={Array.from(ROLE_STEP_INDEXES[role])}
      pathScope={Array.from(ROLE_PATHS[role])}
      formTitle={participant.form.title}
      completedAt={participant.completedAt?.toISOString() ?? null}
    />
  );
}
