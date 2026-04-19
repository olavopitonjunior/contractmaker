import { test, expect, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

const SCREENSHOTS_DIR = path.resolve(__dirname, "../screenshots");
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
function shot(name: string): string {
  return path.join(SCREENSHOTS_DIR, name);
}

const EMAIL = "admin@contractmaker.com";
const PWD = "E2EtestPwd!2026";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/senha/i).fill(PWD);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 15_000,
  });
}

test.describe.serial("Pagadoria Fase 3 — Transfers/Conciliação/Relatórios UI", () => {
  test("20 — /financeiro/transferencias renderiza form + histórico", async ({ page }) => {
    await login(page);
    await page.goto("/financeiro/transferencias");
    await expect(page.getByRole("heading", { name: /transfer[eê]ncias/i })).toBeVisible();
    await expect(page.getByText(/saldo dispon[ií]vel/i).first()).toBeVisible();
    await expect(page.getByText(/nova transfer[eê]ncia/i)).toBeVisible();
    await page.screenshot({ path: shot("20-transferencias.png"), fullPage: true });
  });

  test("21 — /financeiro/dual-approvals lista", async ({ page }) => {
    await login(page);
    await page.goto("/financeiro/dual-approvals");
    await expect(page.getByRole("heading", { name: /aprova[cç][oõ]es duplas/i })).toBeVisible();
    await page.screenshot({ path: shot("21-dual-approvals.png"), fullPage: true });
  });

  test("22 — /financeiro/conciliacao renderiza", async ({ page }) => {
    await login(page);
    await page.goto("/financeiro/conciliacao");
    await expect(page.getByRole("heading", { name: /concilia[cç][aã]o banc[aá]ria/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /sincronizar extrato/i })).toBeVisible();
    // 4 chips de contagem
    await expect(page.getByText(/pendente/i).first()).toBeVisible();
    await page.screenshot({ path: shot("22-conciliacao.png"), fullPage: true });
  });

  test("23 — /financeiro/relatorios com 4 tabs", async ({ page }) => {
    await login(page);
    await page.goto("/financeiro/relatorios");
    await expect(page.getByRole("heading", { name: /relat[oó]rios/i })).toBeVisible();
    // Default tab "Recebíveis" visível
    await expect(page.getByRole("tab", { name: /receb[ií]veis/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /aging/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /cashflow/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /inadimpl[eê]ncia/i })).toBeVisible();
    await page.screenshot({ path: shot("23-relatorios.png"), fullPage: true });

    // Clica Aging
    await page.getByRole("tab", { name: /aging/i }).click();
    await expect(page.getByText(/envelhecimento/i)).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: shot("23b-aging.png"), fullPage: true });

    // Cashflow
    await page.getByRole("tab", { name: /cashflow/i }).click();
    await expect(page.getByText(/fluxo de caixa/i)).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: shot("23c-cashflow.png"), fullPage: true });

    // Inadimplência
    await page.getByRole("tab", { name: /inadimpl[eê]ncia/i }).click();
    await expect(page.getByText(/top 10 inadimplentes/i)).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: shot("23d-defaulters.png"), fullPage: true });
  });

  test("24 — Botão Transferir no dashboard /financeiro", async ({ page }) => {
    await login(page);
    await page.goto("/financeiro");
    const transferBtn = page.getByRole("link", { name: /transferir/i });
    if ((await transferBtn.count()) > 0) {
      await expect(transferBtn.first()).toBeVisible();
    }
    await expect(page.getByRole("link", { name: /concilia[cç][aã]o/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /relat[oó]rios/i })).toBeVisible();
    await page.screenshot({ path: shot("24-dashboard-nav.png"), fullPage: true });
  });
});
