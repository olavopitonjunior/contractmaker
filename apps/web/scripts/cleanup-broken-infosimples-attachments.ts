/**
 * apps/web/scripts/cleanup-broken-infosimples-attachments.ts
 *
 * Limpa anexos `DealAttachment source="infosimples"` que foram criados ERRADO
 * a partir de endpoints informativos (emitsPdf:false — ex.: receita-federal/cpf,
 * Cartão CNPJ, CRF FGTS, eproc-lista). Esses `site_receipts` NÃO são PDF de
 * certidão; ficaram gravados como application/pdf e quebram o viewer ("erro no
 * PDF"). O fix (gate emitsPdf + magic %PDF) previne NOVOS; este script remove os
 * antigos.
 *
 * Critério: anexo infosimples cujo endpoint (extractedData.certidao.endpoint)
 * tem `emitsPdf === false` E cujo conteúdo NÃO começa com "%PDF-".
 *
 * Uso (a partir de apps/web):
 *   pnpm tsx scripts/cleanup-broken-infosimples-attachments.ts          # dry-run
 *   pnpm tsx scripts/cleanup-broken-infosimples-attachments.ts --apply  # executa
 */
import { readFileSync } from "fs";
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(m[1] in process.env)) process.env[m[1]] = v;
}

import { prisma } from "../src/lib/db/prisma";
import { downloadBufferFromUrl } from "../src/lib/storage/s3";
import { endpointInfo } from "../src/lib/certidoes/endpoints";

const APPLY = process.argv.includes("--apply");

function endpointOf(extractedData: unknown): string | null {
  const ed = extractedData as { certidao?: { endpoint?: string } } | null;
  return ed?.certidao?.endpoint ?? null;
}

async function isInformativoEndpoint(endpoint: string | null): Promise<boolean> {
  if (!endpoint) return false;
  try {
    return endpointInfo(endpoint).emitsPdf === false;
  } catch {
    return false;
  }
}

(async () => {
  const attachments = await prisma.dealAttachment.findMany({
    where: { source: "infosimples" },
    select: { id: true, dealId: true, filename: true, url: true, mime: true, extractedData: true },
  });
  console.log(`Total anexos infosimples: ${attachments.length}`);

  const broken: Array<{ id: string; dealId: string; filename: string; endpoint: string | null; reason: string }> = [];
  for (const a of attachments) {
    const endpoint = endpointOf(a.extractedData);
    if (!(await isInformativoEndpoint(endpoint))) continue; // só endpoints informativos
    // Confirma que o conteúdo realmente não é PDF (defensivo).
    let notPdf = true;
    try {
      const buf = await downloadBufferFromUrl(a.url);
      notPdf = buf.subarray(0, 5).toString("latin1") !== "%PDF-";
    } catch (e) {
      notPdf = true; // blob inacessível/corrompido → também é lixo
    }
    if (notPdf) {
      broken.push({ id: a.id, dealId: a.dealId, filename: a.filename, endpoint, reason: "informativo + não-PDF" });
    }
  }

  console.log(`\nAnexos quebrados (informativo + não-PDF): ${broken.length}`);
  for (const b of broken) {
    console.log(`  - ${b.filename} | endpoint=${b.endpoint} | deal=${b.dealId} | id=${b.id}`);
  }

  if (!APPLY) {
    console.log(`\n[DRY-RUN] Nada removido. Rode com --apply para deletar (${broken.length}).`);
    await prisma.$disconnect();
    return;
  }

  let deleted = 0;
  for (const b of broken) {
    await prisma.$transaction([
      prisma.certidaoJob.updateMany({ where: { attachmentId: b.id }, data: { attachmentId: null } }),
      prisma.dealAttachment.delete({ where: { id: b.id } }),
    ]);
    deleted++;
  }
  console.log(`\n[APPLY] Removidos ${deleted} anexo(s) quebrado(s) + nulificado attachmentId nos jobs.`);
  await prisma.$disconnect();
})().catch((e) => {
  console.error("ERR:", e?.message ?? e);
  process.exit(1);
});
