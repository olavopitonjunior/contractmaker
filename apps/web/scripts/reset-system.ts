/**
 * Reset operational data to start real usage. Wipes:
 *   Deal → Contract → DealAttachment → CertidaoJob → SalesForm → FormAttachment
 *   CommissionCharge → ChargePublicLink, AsaasTransfer, AsaasWebhookEvent, AsaasCustomer
 *   Notification, ClauseProposal, ContractMemory, AIUsage (default)
 *   Resets Clause.usageCount to 0
 *
 * Preserves:
 *   Organization, User, OrgMembership, OrgInvitation, Pipeline, PipelineStage,
 *   ContractTemplate, Clause (rows), DocumentStyle, AsaasAccount,
 *   OrgFinancialSettings, SplitRecipient, AuditLog (default)
 *
 * Usage:
 *   npx tsx scripts/reset-system.ts                  # dry-run
 *   npx tsx scripts/reset-system.ts --yes            # apply
 *   npx tsx scripts/reset-system.ts --yes --include-audit       # also wipe AuditLog
 *   npx tsx scripts/reset-system.ts --yes --keep-ai-usage       # preserve AIUsage history
 *
 * Env: DATABASE_URL (read from .env or set inline)
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const apply = process.argv.includes("--yes");
const includeAudit = process.argv.includes("--include-audit");
const keepAiUsage = process.argv.includes("--keep-ai-usage");

async function counts(orgId: string) {
  return {
    Organization: await prisma.organization.count(),
    User: await prisma.user.count(),
    OrgMembership: await prisma.orgMembership.count({ where: { orgId } }),
    OrgInvitation: await prisma.orgInvitation.count({ where: { orgId } }),
    Pipeline: await prisma.pipeline.count({ where: { orgId } }),
    PipelineStage: await prisma.pipelineStage.count({ where: { pipeline: { orgId } } }),
    ContractTemplate: await prisma.contractTemplate.count({ where: { orgId } }),
    Clause: await prisma.clause.count({ where: { orgId } }),
    DocumentStyle: await prisma.documentStyle.count({ where: { orgId } }),
    AsaasAccount: await prisma.asaasAccount.count({ where: { orgId } }),
    OrgFinancialSettings: await prisma.orgFinancialSettings.count({ where: { orgId } }),
    SplitRecipient: await prisma.splitRecipient.count({ where: { orgId } }),
    AuditLog: await prisma.auditLog.count({ where: { orgId } }),

    Deal: await prisma.deal.count({ where: { pipeline: { orgId } } }),
    Contract: await prisma.contract.count({ where: { deal: { pipeline: { orgId } } } }),
    SalesForm: await prisma.salesForm.count({ where: { orgId } }),
    DealAttachment: await prisma.dealAttachment.count({ where: { deal: { pipeline: { orgId } } } }),
    FormAttachment: await prisma.formAttachment.count({ where: { form: { orgId } } }),
    CertidaoJob: await prisma.certidaoJob.count({ where: { OR: [{ orgId }, { deal: { pipeline: { orgId } } }] } }),
    ContractComment: await prisma.contractComment.count({ where: { contract: { deal: { pipeline: { orgId } } } } }),
    ContractSuggestion: await prisma.contractSuggestion.count({ where: { contract: { deal: { pipeline: { orgId } } } } }),
    ContractChangeLog: await prisma.contractChangeLog.count({ where: { contract: { deal: { pipeline: { orgId } } } } }),
    ChatSession: await prisma.chatSession.count({ where: { contract: { deal: { pipeline: { orgId } } } } }),
    Export: await prisma.export.count({ where: { contract: { deal: { pipeline: { orgId } } } } }),
    DiligentedPerson: await prisma.diligentedPerson.count({ where: { deal: { pipeline: { orgId } } } }),
    Notification: await prisma.notification.count({ where: { orgId } }),
    CommissionCharge: await prisma.commissionCharge.count({ where: { orgId } }),
    AsaasTransfer: await prisma.asaasTransfer.count({ where: { orgId } }),
    AsaasCustomer: await prisma.asaasCustomer.count({ where: { orgId } }),
    AsaasWebhookEvent: await prisma.asaasWebhookEvent.count({ where: { orgId } }),
    BankReconciliation: await prisma.bankReconciliation.count({ where: { orgId } }),
    ClauseProposal: await prisma.clauseProposal.count({ where: { orgId } }),
    AIUsage: await prisma.aIUsage.count({ where: { orgId } }),
    ContractMemory: await prisma.contractMemory.count({ where: { orgId } }),
  };
}

async function main() {
  // Multitenant (Fase 0c): sem default de org — exige --org-id explícito.
  const orgIdx = process.argv.indexOf("--org-id");
  const orgId = orgIdx >= 0 ? process.argv[orgIdx + 1] : undefined;
  if (!orgId) {
    console.error("❌ --org-id <orgId> é obrigatório (multitenant — sem default de org)");
    process.exit(1);
  }
  const dbUrl = process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":***@");

  console.log("================================================");
  console.log(`[reset-system] ${apply ? "APPLY MODE (irreversible)" : "DRY RUN"}`);
  console.log(`[reset-system] orgId: ${orgId}`);
  console.log(`[reset-system] DB:    ${dbUrl}`);
  console.log(`[reset-system] flags: includeAudit=${includeAudit}  keepAiUsage=${keepAiUsage}`);
  console.log("================================================\n");

  const before = await counts(orgId);
  console.log("BEFORE:");
  console.log(JSON.stringify(before, null, 2));
  console.log();

  if (!apply) {
    console.log("[reset-system] Dry-run only. Run with --yes to apply.");
    return;
  }

  console.log("[reset-system] Deleting in cascade order...\n");

  await prisma.$transaction(
    async (tx) => {
      const t1 = await tx.asaasTransfer.deleteMany({ where: { orgId } });
      console.log(`  AsaasTransfer:       ${t1.count}`);

      const t2 = await tx.asaasWebhookEvent.deleteMany({ where: { orgId } });
      console.log(`  AsaasWebhookEvent:   ${t2.count}`);

      const t3 = await tx.commissionCharge.deleteMany({ where: { orgId } });
      console.log(`  CommissionCharge:    ${t3.count} (cascade ChargePublicLink)`);

      const t4 = await tx.bankReconciliation.deleteMany({ where: { orgId } });
      console.log(`  BankReconciliation:  ${t4.count}`);

      const t5 = await tx.asaasCustomer.deleteMany({ where: { orgId } });
      console.log(`  AsaasCustomer:       ${t5.count}`);

      const t6 = await tx.notification.deleteMany({ where: { orgId } });
      console.log(`  Notification:        ${t6.count}`);

      const t7 = await tx.clauseProposal.deleteMany({ where: { orgId } });
      console.log(`  ClauseProposal:      ${t7.count}`);

      const t8 = await tx.contract.deleteMany({ where: { deal: { pipeline: { orgId } } } });
      console.log(`  Contract:            ${t8.count} (cascade comments/suggestions/changeLogs/chat/exports/clauses/envelopes)`);

      const t9 = await tx.deal.deleteMany({ where: { pipeline: { orgId } } });
      console.log(`  Deal:                ${t9.count} (cascade attachments/certidaoJobs/diligentedPersons/shareLinks)`);

      const t9b = await tx.certidaoJob.deleteMany({ where: { orgId } });
      console.log(`  CertidaoJob (ad-hoc):${t9b.count}`);

      const t10 = await tx.salesForm.deleteMany({ where: { orgId } });
      console.log(`  SalesForm:           ${t10.count} (cascade FormAttachment)`);

      const t11 = await tx.contractMemory.deleteMany({ where: { orgId } });
      console.log(`  ContractMemory:      ${t11.count}`);

      if (!keepAiUsage) {
        const t12 = await tx.aIUsage.deleteMany({ where: { orgId } });
        console.log(`  AIUsage:             ${t12.count}`);
      } else {
        console.log(`  AIUsage:             SKIPPED (--keep-ai-usage)`);
      }

      if (includeAudit) {
        const t13 = await tx.auditLog.deleteMany({ where: { orgId } });
        console.log(`  AuditLog:            ${t13.count}`);
      } else {
        console.log(`  AuditLog:            SKIPPED (preserved by default — use --include-audit to wipe)`);
      }

      const t14 = await tx.clause.updateMany({ where: { orgId }, data: { usageCount: 0 } });
      console.log(`  Clause.usageCount=0: ${t14.count}`);
    },
    { timeout: 60_000 }
  );

  console.log("\n[reset-system] Verifying...\n");
  const after = await counts(orgId);
  console.log("AFTER:");
  console.log(JSON.stringify(after, null, 2));
  console.log();

  const expectedZero = [
    "Deal", "Contract", "SalesForm", "DealAttachment", "FormAttachment",
    "CertidaoJob", "ContractComment", "ContractSuggestion", "ContractChangeLog",
    "ChatSession", "Export", "DiligentedPerson", "Notification",
    "CommissionCharge", "AsaasTransfer", "AsaasCustomer", "AsaasWebhookEvent",
    "BankReconciliation", "ClauseProposal", "ContractMemory",
  ] as const;
  if (!keepAiUsage) (expectedZero as readonly string[]).concat(["AIUsage"]);

  const failures: string[] = [];
  for (const k of expectedZero) {
    if ((after as Record<string, number>)[k] !== 0) {
      failures.push(`${k}=${(after as Record<string, number>)[k]} (expected 0)`);
    }
  }
  if (!keepAiUsage && after.AIUsage !== 0) failures.push(`AIUsage=${after.AIUsage} (expected 0)`);

  const expectedPreserved: Array<[keyof typeof before, number]> = [
    ["Organization", before.Organization],
    ["User", before.User],
    ["OrgMembership", before.OrgMembership],
    ["Pipeline", before.Pipeline],
    ["PipelineStage", before.PipelineStage],
    ["ContractTemplate", before.ContractTemplate],
    ["Clause", before.Clause],
    ["DocumentStyle", before.DocumentStyle],
    ["AsaasAccount", before.AsaasAccount],
    ["OrgFinancialSettings", before.OrgFinancialSettings],
    ["SplitRecipient", before.SplitRecipient],
  ];
  if (!includeAudit) expectedPreserved.push(["AuditLog", before.AuditLog]);

  for (const [k, expected] of expectedPreserved) {
    const actual = (after as Record<string, number>)[k as string];
    if (actual !== expected) failures.push(`${k}=${actual} (expected ${expected} preserved)`);
  }

  if (failures.length) {
    console.error("[reset-system] VERIFICATION FAILED:");
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }

  console.log("[reset-system] ✓ done — system reset, configs preserved.");
}

main()
  .catch((err) => {
    console.error("[reset-system] ERROR:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
