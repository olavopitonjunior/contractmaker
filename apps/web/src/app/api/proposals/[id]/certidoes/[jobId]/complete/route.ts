import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { runSingleJob } from "@/lib/certidoes/executor";
import { endpointInfo } from "@/lib/certidoes/endpoints";
import { sanitizePayload } from "@/lib/certidoes/infosimples";
import { loadProposalCertidoesScope } from "@/lib/certidoes/proposal-subject";
import { planProposalCertidoes } from "@/lib/certidoes/proposal-dispatch";
import { TERMINAL_STATUSES } from "@/lib/proposals/status-sets";
import { PARTY_IDENTITY_FIELDS, getAtPath } from "@/lib/proposals/party-fields";

export const runtime = "nodejs";
export const maxDuration = 660;

const completeSchema = z.object({
  fields: z.record(z.union([z.string(), z.number(), z.null()])),
});

/** Só caminhos dentro das partes/imóvel — o "Corrigir dados" não escreve fora disso. */
const ALLOWED_PATH_PREFIX = /^(locatarios|locadores|garantia\.fiador|vendedores|compradores|imoveis|imovel)(\.|$)/;

/**
 * POST /api/proposals/:id/certidoes/:jobId/complete — destrava um job pulado
 * ("complete os dados"): grava os campos no `dataJson` da PROPOSTA pelos
 * caminhos do planner, replaneja e recria o job. Espelho do Deal, com a
 * escrita no lugar certo (a proposta não tem SalesForm).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string; jobId: string } }) {
  const r = await loadProposalCertidoesScope(req, params.id, { write: true });
  if ("fail" in r) return r.fail;
  const { scope } = r;

  const parsed = completeSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  for (const path of Object.keys(parsed.data.fields)) {
    if (!ALLOWED_PATH_PREFIX.test(path) || path.includes("__proto__") || path.includes("constructor")) {
      return NextResponse.json({ error: `Caminho não permitido: ${path}` }, { status: 400 });
    }
  }

  const job = await prisma.certidaoJob.findUnique({ where: { id: params.jobId } });
  if (!job || job.proposalId !== scope.proposal.id) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  const jobResult = job.resultData as { failureCategory?: string } | null;
  const isUserFixable =
    jobResult?.failureCategory === "missing_input" || jobResult?.failureCategory === "inconsistent_input";
  const acceptable =
    job.status === "skipped" || ((job.status === "success" || job.status === "failed") && isUserFixable);
  if (!acceptable) {
    return NextResponse.json(
      { error: "Este job nao aceita complemento/edicao — ja esta em estado terminal valido" },
      { status: 400 }
    );
  }

  // Mesmo invariante da rota `/partes`: identidade (`nome`/`cpf`/`cnpj`/
  // `razao_social`) só entra quando ainda vazia — "corrigir dados" de uma
  // certidão não pode trocar o CPF de um proponente já enviado por uma porta
  // lateral.
  for (const [path, value] of Object.entries(parsed.data.fields)) {
    const leaf = path.split(".").pop() ?? "";
    if (!PARTY_IDENTITY_FIELDS.has(leaf)) continue;
    const current = getAtPath(scope.dataJson, path);
    const cur = typeof current === "string" ? current.trim() : "";
    if (cur && String(value ?? "").trim() !== cur) {
      return NextResponse.json({ error: `${leaf} já preenchido não pode ser alterado por aqui` }, { status: 409 });
    }
  }

  const merged = setByPath(structuredClone(scope.dataJson), parsed.data.fields);
  const claimed = await prisma.proposal.updateMany({
    where: { id: scope.proposal.id, status: { notIn: [...TERMINAL_STATUSES].filter((s) => s !== "completa") } },
    data: { dataJson: merged as Prisma.InputJsonValue },
  });
  if (claimed.count === 0) {
    return NextResponse.json({ error: "Proposta encerrada." }, { status: 409 });
  }

  const plan = await planProposalCertidoes({
    dataJson: merged,
    esteira: scope.esteira,
    userEmail: scope.userEmail,
    expandAll: true,
  });
  const newPlanned = plan.jobs.find(
    (p) => p.endpoint === job.endpoint && p.targetKind === job.targetKind && p.targetIndex === job.targetIndex
  );
  if (!newPlanned) {
    const stillSkipped = plan.skipped.find(
      (s) => s.endpoint === job.endpoint && s.targetKind === job.targetKind && s.targetIndex === job.targetIndex
    );
    return NextResponse.json(
      { error: "Dados ainda insuficientes apos merge. Verifique os campos enviados.", stillSkipped },
      { status: 400 }
    );
  }

  await prisma.certidaoJob.update({
    where: { id: job.id },
    data: { status: "replaced", finishedAt: new Date() },
  });
  const info = endpointInfo(newPlanned.endpoint);
  const newJob = await prisma.certidaoJob.create({
    data: {
      proposalId: scope.proposal.id,
      orgId: scope.orgId,
      userId: scope.userId,
      batchId: job.batchId,
      endpoint: newPlanned.endpoint,
      label: newPlanned.label,
      targetKind: newPlanned.targetKind,
      targetIndex: newPlanned.targetIndex,
      requestPayload: sanitizePayload(newPlanned.requestPayload) as object,
      status: info.initialStatus ?? "pending",
      costCents: null,
      portalUrl: info.portalUrl ?? null,
    },
  });

  waitUntil(runSingleJob(newJob.id, null).catch((err) => console.error("[certidoes] complete retry failed", err)));
  return NextResponse.json({ ok: true, newJobId: newJob.id }, { status: 202 });
}

function setByPath(obj: Record<string, unknown>, updates: Record<string, unknown>): Record<string, unknown> {
  for (const [path, value] of Object.entries(updates)) {
    const parts = path.split(".");
    let cursor: Record<string, unknown> | unknown[] = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      const nextIsArrayIdx = /^\d+$/.test(parts[i + 1]);
      const holder = cursor as Record<string, unknown>;
      const existing = Array.isArray(cursor) ? cursor[Number(key)] : holder[key];
      const next = existing == null || typeof existing !== "object" ? (nextIsArrayIdx ? [] : {}) : existing;
      if (Array.isArray(cursor)) cursor[Number(key)] = next;
      else holder[key] = next;
      cursor = next as Record<string, unknown>;
    }
    const last = parts[parts.length - 1];
    if (Array.isArray(cursor)) cursor[Number(last)] = value;
    else (cursor as Record<string, unknown>)[last] = value;
  }
  return obj;
}
