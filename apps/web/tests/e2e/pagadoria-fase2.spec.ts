import { test, expect, type Page } from "@playwright/test";
import { authenticator } from "otplib";
import * as fs from "node:fs";
import * as path from "node:path";

authenticator.options = { window: 1, step: 30, digits: 6 };

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

test.describe.serial("Pagadoria Fase 2 — Financeiro UI", () => {
  test("10 — /financeiro/cobrancas lista", async ({ page }) => {
    await login(page);
    await page.goto("/financeiro/cobrancas");
    await expect(page.getByRole("heading", { name: /cobran[cç]as/i }).first()).toBeVisible();
    await expect(page.getByPlaceholder(/nome, cpf/i)).toBeVisible();
    await page.screenshot({ path: shot("10-cobrancas-list.png"), fullPage: true });
  });

  test("11 — /financeiro/clientes CRUD", async ({ page }) => {
    await login(page);
    await page.goto("/financeiro/clientes");
    await expect(page.getByRole("heading", { name: /clientes/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /novo cliente/i })).toBeVisible();
    await page.screenshot({ path: shot("11-clientes.png"), fullPage: true });
  });

  test("12 — /financeiro/extrato carrega (pode mostrar saldo 0)", async ({ page }) => {
    await login(page);
    await page.goto("/financeiro/extrato");
    await expect(page.getByRole("heading", { name: /extrato/i })).toBeVisible();
    await expect(page.getByText(/saldo dispon[ií]vel/i)).toBeVisible();
    await page.screenshot({ path: shot("12-extrato.png"), fullPage: true });
  });

  test("13 — /financeiro/cobrancas/nova wizard 3 steps", async ({ page }) => {
    await login(page);
    await page.goto("/financeiro/cobrancas/nova");
    await expect(page.getByRole("heading", { name: /nova cobran[çc]a/i })).toBeVisible();
    // Step 1 visível (CardTitle renderiza como div, não heading)
    await expect(page.getByText(/quem vai pagar/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByPlaceholder(/buscar por nome/i)).toBeVisible();
    await page.screenshot({ path: shot("13-nova-step1.png"), fullPage: true });
  });

  test("14 — /settings/pagamentos/taxas com preview ao vivo", async ({ page }) => {
    await login(page);
    await page.goto("/settings/pagamentos/taxas");
    await expect(page.getByRole("heading", { name: /taxas e descontos/i })).toBeVisible();
    // Preview — usa texto exato (aparece múltiplas vezes)
    await expect(page.getByText("Valor nominal", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Cobrado do pagador", { exact: true })).toBeVisible();
    await page.screenshot({ path: shot("14-taxas.png"), fullPage: true });
  });

  test("15 — /settings/pagamentos/branding preview", async ({ page }) => {
    await login(page);
    await page.goto("/settings/pagamentos/branding");
    await expect(
      page.getByRole("heading", { name: /apar[eê]ncia da cobran[çc]a p[uú]blica/i })
    ).toBeVisible();
    await expect(page.getByText(/preview/i).first()).toBeVisible();
    await page.screenshot({ path: shot("15-branding.png"), fullPage: true });
  });

  test("16 — /pay/[token-invalido] retorna 404", async ({ page }) => {
    // Sem login — rota pública. Token inválido chama notFound() server-side → 404.
    const response = await page.goto("/pay/invalidtoken123");
    expect(response?.status()).toBe(404);
    await page.screenshot({ path: shot("16-pay-invalid.png"), fullPage: true });
  });
});
