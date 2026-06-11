import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { planCertidoesForDeal, diligentedPersonToInput } from "@/lib/certidoes/planner";
import { runSingleJob } from "@/lib/certidoes/executor";
import { checkGovBrAuth } from "@/lib/certidoes/govbr-auth";
import { checkOnrAuth } from "@/lib/certidoes/onr-auth";
import { endpointInfo } from "@/lib/certidoes/endpoints";
import { sanitizePayload } from "@/lib/certidoes/infosimples";
import { z } from "zod";

export const runtime = "nodejs";
// I.7 (2026-05-11) — complete dispara runSingleJob via waitUntil; pode ser
// TJSP que demora 3-10min com auth GOV.BR. Alinha com POST /certidoes.
export const maxDuration = 660;

const completeSchema = z.object({
  fields: z.record(z.union([z.string(), z.number(), z.null()])),
});

/**
 * POST /api/deals/:dealId/certidoes/:jobId/complete
 *
 * Unblocks a skipped CertidaoJob by:
 *   1. Merging the provided fields into deal.dataJson (and form.dataJson)
 *      using the path pointers (e.g. "vendedores.0.data_nascimento")
 *   2. Re-running the planner
 *   3. Finding the single planned job that matches the original skipped
 *      (same endpoint + targetKind + targetIndex)
 *   4. Creating a new CertidaoJob and firing runSingleJob
 *   5. Marking the original skipped job as status=replaced
 *
 * Body: { fields: { "<path>": <value>, ... } }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string; jobId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = completeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const job = await prisma.certidaoJob.findUnique({
    where: { id: params.jobId },
    include: {
      deal: {
        include: { form: { select: { id: true, orgId: true, dataJson: true } } },
      },
    },
  });
  if (!job || job.dealId !== params.dealId || !job.deal) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  // TypeScript-friendly alias — after the null check above, TS still widens
  // job.deal to nullable on deep access. Capture once as non-null.
  const jobDeal = job.deal;
  if (jobDeal.form && jobDeal.form.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Accept: (a) skipped jobs (missing data), (b) success/failed jobs whose
  // normalized result carries a user-fixable failureCategory (Phase A). Both
  // flows share the merge + re-plan + re-run logic below.
  const jobResult = job.resultData as { failureCategory?: string } | null;
  const isUserFixable =
    jobResult?.failureCategory === "missing_input" ||
    jobResult?.failureCategory === "inconsistent_input";
  const acceptable =
    job.status === "skipped" ||
    ((job.status === "success" || job.status === "failed") && isUserFixable);
  if (!acceptable) {
    return NextResponse.json(
      {
        error:
          "Este job nao aceita complemento/edicao — ja esta em estado terminal valido",
      },
      { status: 400 }
    );
  }

  // Merge new fields into deal.dataJson (and form.dataJson if linked)
  const dealData =
    (jobDeal.form?.dataJson as Record<string, unknown> | null) ||
    (jobDeal.dataJson as Record<string, unknown> | null) ||
    {};
  const merged = setByPath(structuredClone(dealData), parsed.data.fields);

  // Persist merge in both Deal and Form (so future plans see the updated data)
  await prisma.$transaction(async (tx) => {
    await tx.deal.update({
      where: { id: params.dealId },
      data: { dataJson: merged as object },
    });
    if (jobDeal.form?.id) {
      await tx.salesForm.update({
        where: { id: jobDeal.form.id },
        data: { dataJson: merged as object },
      });
    }
  });

  // Re-plan with the merged data. IMPORTANTE: passar as mesmas infos do POST
  // /certidoes — sem govBrActive/onrActive/email/diligenciados, o re-plan do
  // complemento de matrícula ONR (e TJSP, que exige email) re-skipava e o
  // botão "Completar campos" não destravava o job.
  const [govbr, onr] = await Promise.all([checkGovBrAuth(), checkOnrAuth()]);
  const diligenciadosRaw = await prisma.diligentedPerson.findMany({
    where: { dealId: params.dealId },
    orderBy: { createdAt: "asc" },
  });
  const diligenciados = diligenciadosRaw.map(diligentedPersonToInput);
  const plan = planCertidoesForDeal(
    merged as any,
    session.user.email ?? undefined,
    diligenciados,
    { expandAll: true, govBrActive: govbr.active, onrActive: onr.active }
  );
  const newPlanned = plan.jobs.find(
    (p) =>
      p.endpoint === job.endpoint &&
      p.targetKind === job.targetKind &&
      p.targetIndex === job.targetIndex
  );

  if (!newPlanned) {
    // Still skipped after the merge — probably the user filled the wrong field
    const stillSkipped = plan.skipped.find(
      (s) =>
        s.endpoint === job.endpoint &&
        s.targetKind === job.targetKind &&
        s.targetIndex === job.targetIndex
    );
    return NextResponse.json(
      {
        error:
          "Dados ainda insuficientes apos merge. Verifique os campos enviados.",
        stillSkipped,
      },
      { status: 400 }
    );
  }

  // Mark the original as replaced (keeps history of the skipped entry)
  await prisma.certidaoJob.update({
    where: { id: params.jobId },
    data: { status: "replaced", finishedAt: new Date() },
  });

  // Create and fire the new job
  const info = endpointInfo(newPlanned.endpoint);
  const newJob = await prisma.certidaoJob.create({
    data: {
      dealId: params.dealId,
      userId: session.user.id,
      batchId: job.batchId,
      endpoint: newPlanned.endpoint,
      label: newPlanned.label,
      targetKind: newPlanned.targetKind,
      targetIndex: newPlanned.targetIndex,
      diligentedPersonId: newPlanned.diligentedPersonId ?? null,
      requestPayload: sanitizePayload(newPlanned.requestPayload) as object,
      status: info.initialStatus ?? "pending",
      costCents: null,
    },
  });

  waitUntil(
    runSingleJob(newJob.id, params.dealId).catch((err) => {
      console.error("[certidoes] complete retry failed", err);
    })
  );

  return NextResponse.json(
    { ok: true, newJobId: newJob.id },
    { status: 202 }
  );
}

/** Assigns values by dot-path into a deep object in-place. */
function setByPath(
  obj: Record<string, unknown>,
  updates: Record<string, unknown>
): Record<string, unknown> {
  for (const [path, value] of Object.entries(updates)) {
    const parts = path.split(".");
    let cursor: any = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      const nextIsArrayIdx = /^\d+$/.test(parts[i + 1]);
      if (cursor[key] == null) {
        cursor[key] = nextIsArrayIdx ? [] : {};
      }
      cursor = cursor[key];
    }
    cursor[parts[parts.length - 1]] = value;
  }
  return obj;
}
