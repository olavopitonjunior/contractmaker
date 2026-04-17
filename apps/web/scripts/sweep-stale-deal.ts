/**
 * Manually runs the dead-man sweeper for a single deal against the DATABASE_URL
 * configured in the env. Useful for recovery before the hourly cron runs.
 *
 * Usage:
 *   DATABASE_URL="<prod>" npx tsx scripts/sweep-stale-deal.ts --deal <id>
 */
import { sweepStaleJobs } from "../src/lib/certidoes/executor";

async function main() {
  const idx = process.argv.indexOf("--deal");
  const dealId = idx >= 0 ? process.argv[idx + 1] : null;
  if (!dealId) {
    console.error("usage: npx tsx scripts/sweep-stale-deal.ts --deal <id>");
    process.exit(1);
  }
  const swept = await sweepStaleJobs({ dealId, staleAfterMs: 5 * 60_000 });
  console.log(`[sweep] ${swept} job(s) demoted from fetching/pending to failed`);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
