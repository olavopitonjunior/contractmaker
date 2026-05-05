/**
 * Migra contratos legados em TipTap (googleDocId IS NULL) para Google Docs nativo.
 *
 * Causa: até o commit ee060321, o endpoint /api/contracts/[id]/version criava
 * a nova versão com googleDocId=null mesmo quando a versão fonte estava em GDocs.
 * Resultado: ao reabrir, o front cai pro TipTap legacy (deal Sandra Yamamoto teve
 * isso). Este script faz o upload do htmlContent existente como GDoc nativo,
 * aplica DocumentStyle default da org e atualiza a Contract com googleDocId/Url/Status.
 *
 * Uso:
 *   # Dry-run (default) — só lista o que seria migrado
 *   DATABASE_URL=<...> GOOGLE_*=<...> npx tsx scripts/migrate-tiptap-to-gdocs.ts --dealId <dealId>
 *
 *   # Apply
 *   DATABASE_URL=<...> GOOGLE_*=<...> npx tsx scripts/migrate-tiptap-to-gdocs.ts --dealId <dealId> --apply
 *
 *   # Por org (mais agressivo — migra todos os contratos da org)
 *   DATABASE_URL=<...> npx tsx scripts/migrate-tiptap-to-gdocs.ts --orgId <orgId> --apply
 *
 *   # Inclui contratos aprovados (default: skip pra não mexer em docs assinados)
 *   ... --includeApproved --apply
 *
 * Env obrigatórias:
 *   DATABASE_URL, GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_OAUTH_CLIENT_ID,
 *   GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OWNER_REFRESH_TOKEN
 *
 * Env opcionais:
 *   NEXTAUTH_URL + GOOGLE_WATCH_TOKEN — registra watch Drive na nova versão
 *   GOOGLE_DRIVE_FOLDER_ID — pasta de destino dos docs criados
 */
import { PrismaClient } from "@prisma/client";
import { uploadHtmlAsGoogleDoc } from "../src/lib/google/upload-rendered-html";
import { googleApplyStylePreset } from "../src/lib/ai/google-tool-handlers";
import { watchFile } from "../src/lib/google/watch";

const prisma = new PrismaClient();

function getArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const DEAL_ID = getArg("--dealId");
const ORG_ID = getArg("--orgId");
const INCLUDE_APPROVED = process.argv.includes("--includeApproved");
const APPLY = process.argv.includes("--apply");

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface MigrationOutcome {
  contractId: string;
  version: number;
  status: string;
  ok: boolean;
  docId?: string;
  error?: string;
}

async function migrateOne(contract: {
  id: string;
  version: number;
  status: string;
  htmlContent: string | null;
  dealId: string;
}): Promise<MigrationOutcome> {
  if (!contract.htmlContent || contract.htmlContent.trim().length === 0) {
    return {
      contractId: contract.id,
      version: contract.version,
      status: contract.status,
      ok: false,
      error: "htmlContent vazio — pulando (sem fonte para upload)",
    };
  }

  // 1. Upload HTML como GDoc nativo
  let created: { docId: string; webViewLink: string };
  try {
    created = await uploadHtmlAsGoogleDoc({
      htmlContent: contract.htmlContent,
      name: `Contrato ${contract.id} — v${contract.version}`,
    });
  } catch (err) {
    return {
      contractId: contract.id,
      version: contract.version,
      status: contract.status,
      ok: false,
      error: `upload falhou: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 2. Aplica DocumentStyle default da org (se houver)
  try {
    const deal = await prisma.deal.findUnique({
      where: { id: contract.dealId },
      select: { pipeline: { select: { orgId: true } } },
    });
    const orgId = deal?.pipeline?.orgId;
    if (orgId) {
      const defaultStyle = await prisma.documentStyle.findFirst({
        where: { orgId, isDefault: true },
      });
      if (defaultStyle) {
        await googleApplyStylePreset(created.docId, {
          fontFamily: defaultStyle.fontFamily,
          fontSizeBase: defaultStyle.fontSizeBase,
          lineHeight: defaultStyle.lineHeight,
          colorPrimary: defaultStyle.colorPrimary,
          marginTopMm: defaultStyle.marginTopMm,
          marginBottomMm: defaultStyle.marginBottomMm,
          marginLeftMm: defaultStyle.marginLeftMm,
          marginRightMm: defaultStyle.marginRightMm,
        });
      }
    }
  } catch (err) {
    console.warn(
      `  [${contract.id} v${contract.version}] DocumentStyle apply falhou (segue):`,
      err instanceof Error ? err.message : err
    );
  }

  // 3. Watch Drive (best-effort)
  let watchData: {
    googleWatchChannel?: string;
    googleWatchResource?: string;
    googleWatchExpires?: Date;
  } = {};
  const webhookBase = process.env.NEXTAUTH_URL || process.env.PUBLIC_APP_URL;
  const watchToken = process.env.GOOGLE_WATCH_TOKEN?.trim();
  if (webhookBase && watchToken) {
    try {
      const watch = await watchFile({
        fileId: created.docId,
        webhookUrl: `${webhookBase.replace(/\/$/, "")}/api/webhooks/google-drive`,
        token: watchToken,
      });
      watchData = {
        googleWatchChannel: watch.channelId,
        googleWatchResource: watch.resourceId,
        googleWatchExpires: new Date(watch.expiration),
      };
    } catch (err) {
      console.warn(
        `  [${contract.id} v${contract.version}] watch falhou (segue):`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // 4. Atualiza Contract no DB
  await prisma.contract.update({
    where: { id: contract.id },
    data: {
      googleDocId: created.docId,
      googleDocUrl: created.webViewLink,
      googleDocStatus:
        contract.status === "aprovado" ? "approved_readonly" : "draft",
      ...watchData,
    },
  });

  return {
    contractId: contract.id,
    version: contract.version,
    status: contract.status,
    ok: true,
    docId: created.docId,
  };
}

async function main() {
  console.log(`[migrate-tiptap-to-gdocs] ${APPLY ? "APPLY MODE" : "DRY RUN"}`);
  console.log(`[migrate-tiptap-to-gdocs] DB: ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":***@")}`);
  console.log(`[migrate-tiptap-to-gdocs] scope: ${DEAL_ID ? `deal=${DEAL_ID}` : ORG_ID ? `org=${ORG_ID}` : "ALL (perigoso!)"}`);
  console.log(`[migrate-tiptap-to-gdocs] includeApproved: ${INCLUDE_APPROVED}`);
  console.log();

  if (!DEAL_ID && !ORG_ID) {
    console.error(
      "ERRO: passe --dealId ou --orgId. Migrar tudo de uma vez sem escopo seria perigoso."
    );
    process.exit(1);
  }

  const where: Record<string, unknown> = { googleDocId: null };
  if (DEAL_ID) where.dealId = DEAL_ID;
  if (ORG_ID) {
    where.deal = { pipeline: { orgId: ORG_ID } };
  }
  if (!INCLUDE_APPROVED) {
    where.status = { not: "aprovado" };
  }

  const candidates = await prisma.contract.findMany({
    where,
    select: {
      id: true,
      version: true,
      status: true,
      htmlContent: true,
      dealId: true,
      isLatest: true,
      deal: {
        select: { title: true },
      },
    },
    orderBy: [{ dealId: "asc" }, { version: "asc" }],
  });

  console.log(`Candidatos encontrados: ${candidates.length}`);
  candidates.forEach((c) =>
    console.log(
      `  - ${c.id} v${c.version} status=${c.status} ${c.isLatest ? "[latest]" : ""} htmlLen=${c.htmlContent?.length ?? 0} deal="${c.deal.title}"`
    )
  );

  if (!APPLY) {
    console.log();
    console.log("[migrate-tiptap-to-gdocs] Run with --apply to actually migrate.");
    return;
  }

  if (candidates.length === 0) {
    console.log("\nNada a fazer.");
    return;
  }

  console.log();
  console.log(`Migrando ${candidates.length} contratos sequencialmente (sleep 500ms entre items)...`);
  console.log();

  const outcomes: MigrationOutcome[] = [];
  for (const c of candidates) {
    process.stdout.write(`[${c.id} v${c.version}] `);
    const out = await migrateOne(c);
    outcomes.push(out);
    if (out.ok) {
      console.log(`✓ docId=${out.docId}`);
    } else {
      console.log(`✗ ${out.error}`);
    }
    await sleep(500);
  }

  const ok = outcomes.filter((o) => o.ok).length;
  const fail = outcomes.length - ok;
  console.log();
  console.log(`[migrate-tiptap-to-gdocs] migrados: ${ok}, falhas: ${fail}`);
  if (fail > 0) {
    console.log("Falhas:");
    outcomes.filter((o) => !o.ok).forEach((o) => console.log(`  - ${o.contractId} v${o.version}: ${o.error}`));
  }
}

main()
  .catch((err) => {
    console.error("[migrate-tiptap-to-gdocs] ERROR:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
