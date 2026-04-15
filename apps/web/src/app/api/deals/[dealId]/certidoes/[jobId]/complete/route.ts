import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { planCertidoesForDeal } from "@/lib/certidoes/planner";
import { runSingleJob } from "@/lib/certidoes/executor";
import { endpointInfo } from "@/lib/certidoes/endpoints";
import { sanitizePayload } from "@/lib/certidoes/infosimples";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;

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
  if (!job || job.dealId !== params.dealId) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.deal.form && job.deal.form.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (job.status !== "skipped") {
    return NextResponse.json(
      { error: "Este job nao esta pulado" },
      { status: 400 }
    );
  }

  // Merge new fields into deal.dataJson (and form.dataJson if linked)
  const dealData =
    (job.deal.form?.dataJson as Record<string, unknown> | null) ||
    (job.deal.dataJson as Record<string, unknown> | null) ||
    {};
  const merged = setByPath(structuredClone(dealData), parsed.data.fields);

  // Persist merge in both Deal and Form (so future plans see the updated data)
  await prisma.$transaction(async (tx) => {
    await tx.deal.update({
      where: { id: params.dealId },
      data: { dataJson: merged as object },
    });
    if (job.deal.form?.id) {
      await tx.salesForm.update({
        where: { id: job.deal.form.id },
        data: { dataJson: merged as object },
      });
    }
  });

  // Re-plan with the merged data
  const plan = planCertidoesForDeal(merged as any);
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
      requestPayload: sanitizePayload(newPlanned.requestPayload) as object,
      status: info.initialStatus ?? "pending",
      costCents: null,
    },
  });

  void runSingleJob(newJob.id, params.dealId).catch((err) => {
    console.error("[certidoes] complete retry failed", err);
  });

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
