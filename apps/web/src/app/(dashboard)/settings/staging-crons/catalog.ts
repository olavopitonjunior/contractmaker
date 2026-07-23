// Lista canônica dos crons + label + flag "real-money" pra UI alertar.
// Movida pra módulo separado pq Next.js só aceita exports padronizados em page.tsx.
export const CRON_CATALOG = [
  { path: "/api/cron/ocr-queue", label: "OCR queue", schedule: "*/1 * * * *", realMoney: false },
  { path: "/api/cron/intents/expire", label: "Action intents expire", schedule: "*/10 * * * *", realMoney: false },
  { path: "/api/cron/drafts/cleanup", label: "Drafts cleanup", schedule: "0 3 * * *", realMoney: false },
  { path: "/api/cron/agent-runs/cleanup", label: "AgentRun cleanup", schedule: "0 4 * * *", realMoney: false },
  { path: "/api/cron/api-usage/cleanup", label: "AIUsage cleanup", schedule: "0 4 * * *", realMoney: false },
  { path: "/api/cron/webhooks/retry-orphaned", label: "Webhooks retry", schedule: "0 3 * * *", realMoney: false },
  { path: "/api/cron/google-watches/renew", label: "Google Drive watches renew", schedule: "0 */6 * * *", realMoney: false },
  { path: "/api/cron/charges/due-soon", label: "Cobranças D-3 notify", schedule: "0 12 * * *", realMoney: true },
  { path: "/api/cron/clicksign/sync-envelopes", label: "ClickSign sync (fallback)", schedule: "0 6 * * *", realMoney: false },
  { path: "/api/cron/ilist/sync-listings", label: "iList listings sync", schedule: "0 */6 * * *", realMoney: false },
  { path: "/api/cron/newton-requests/sweep", label: "Newton sweep", schedule: "0 * * * *", realMoney: true },
  { path: "/api/cron/newton-requests/group-match", label: "Newton group-match", schedule: "30 * * * *", realMoney: false },
  { path: "/api/cron/certidoes/poll-portal", label: "Certidões poll portal", schedule: "*/5 * * * *", realMoney: true },
  { path: "/api/cron/certidoes/problem-digest", label: "Certidões digest email", schedule: "0 13 * * *", realMoney: true },
  { path: "/api/cron/asaas/transfer-dispatch", label: "Asaas transfer dispatch", schedule: "*/10 * * * *", realMoney: true },
  { path: "/api/cron/locacao/newton/check-late-payments", label: "Newton: late payments", schedule: "0 8 * * *", realMoney: true },
  { path: "/api/cron/locacao/newton/check-readjustments", label: "Newton: readjustments", schedule: "0 9 * * *", realMoney: true },
  { path: "/api/cron/rent/generate", label: "Rent charges materialize", schedule: "0 0 1 * *", realMoney: true },
  { path: "/api/cron/rent/readjust", label: "Rent readjustments propose", schedule: "0 1 1 * *", realMoney: true },
] as const;
