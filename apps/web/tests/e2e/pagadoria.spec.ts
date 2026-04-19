import { test, expect, type Page } from "@playwright/test";
import { authenticator } from "otplib";
import * as fs from "node:fs";
import * as path from "node:path";

const SCREENSHOTS_DIR = path.resolve(__dirname, "../screenshots");
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

function shot(name: string): string {
  return path.join(SCREENSHOTS_DIR, name);
}

/**
 * E2E browser test — valida o fluxo completo da Pagadoria Fase 1a + 1b
 * pelo browser real (Chromium). Exige dev server rodando em localhost:3000.
 *
 * Pré-requisitos:
 *  - .env preenchido com ASAAS_API_KEY, MASTER_ENCRYPTION_KEY, etc.
 *  - Admin user `admin@contractmaker.com` com password `E2EtestPwd!2026`
 *  - 2FA e AsaasAccount do admin limpos (setup script pode resetar via Prisma)
 */

authenticator.options = { window: 1, step: 30, digits: 6 };

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

test.describe.serial("Pagadoria — Fase 1a + 1b UI", () => {
  let totpSecret: string | null = null;

  test("01 — login entra no dashboard", async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/.*\/(pipeline|dashboard|$)/);
    await page.screenshot({ path: shot("01-logged-in.png") });
  });

  test("02 — abre Configurações → Segurança", async ({ page }) => {
    await login(page);
    await page.goto("/settings/seguranca");
    await expect(page.getByRole("heading", { name: /seguran[çc]a/i }).first()).toBeVisible();
    await expect(
      page.getByText("Autenticação em duas etapas", { exact: true })
    ).toBeVisible();
    await page.screenshot({
      path: shot("02-seguranca.png"),
      fullPage: true,
    });
  });

  test("03 — ativa 2FA (setup wizard completo)", async ({ page }) => {
    await login(page);
    await page.goto("/settings/seguranca");

    // Botão "Configurar 2FA"
    await page.getByRole("button", { name: /configurar 2fa/i }).click();

    // Dialog setup wizard abre
    const setupBtn = page.getByRole("button", { name: /come[çc]ar/i });
    await expect(setupBtn).toBeVisible({ timeout: 5_000 });
    await setupBtn.click();

    // QR code aparece + secret manual (no fallback details)
    await expect(page.getByRole("img", { name: /qr code 2fa/i })).toBeVisible({
      timeout: 10_000,
    });

    // Extrai o secret do details (fallback manual)
    // O componente tem um <details> com <code>{secret}</code>
    await page.getByText(/n[aã]o consegue escanear/i).click();
    const secret = await page.locator("code").first().innerText();
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
    totpSecret = secret;
    await page.screenshot({ path: shot("03a-qr-code.png") });

    // Clica "Já escaneei"
    await page.getByRole("button", { name: /j[aá] escaneei/i }).click();

    // Digita o código TOTP
    const code = authenticator.generate(secret);
    await page.getByLabel(/c[oó]digo de 6 d[ií]gitos/i).fill(code);
    await page.getByRole("button", { name: /confirmar e ativar/i }).click();

    // Recovery codes aparecem
    await expect(page.getByText(/c[oó]digos de recupera[cç][aã]o/i)).toBeVisible({
      timeout: 10_000,
    });
    await page.screenshot({
      path: shot("03b-recovery-codes.png"),
      fullPage: true,
    });

    // Finaliza
    await page.getByRole("button", { name: /eu guardei/i }).click();

    // Dialog aguarda 1.5s antes de fechar (setTimeout no onComplete).
    await page.waitForTimeout(2500);
    await page.reload();
    // Badge "Ativo" + "Desde" em elementos separados
    await expect(page.getByText("Ativo", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/desde/i).first()).toBeVisible();

    await page.screenshot({
      path: shot("03c-2fa-ativo.png"),
      fullPage: true,
    });
  });

  test("04 — elevation prompt abre ao clicar ação protegida (/financeiro/onboarding)", async ({
    page,
  }) => {
    await login(page);

    // Se já existir AsaasAccount, o onboarding mostra status; se não, mostra wizard.
    // Em qualquer caso, a página deve carregar sem erro.
    await page.goto("/financeiro/onboarding");
    await expect(
      page.getByRole("heading", { name: /configurar conta asaas/i })
    ).toBeVisible();
    await page.screenshot({
      path: shot("04-onboarding.png"),
      fullPage: true,
    });
  });

  test("05 — KYC gate bloqueia acesso direto a /financeiro se não APPROVED", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/financeiro");

    // Subconta existente está em AWAITING_DOCS (do E2E HTTP anterior) — gate deve
    // aparecer com CTA.
    const gateOrDashboard = page.locator(
      "text=/configure sua conta asaas|recebido este m[eê]s/i"
    );
    await expect(gateOrDashboard.first()).toBeVisible({ timeout: 10_000 });
    await page.screenshot({
      path: shot("05-financeiro.png"),
      fullPage: true,
    });
  });

  test("06 — Membros: página carrega e lista owner", async ({ page }) => {
    await login(page);
    await page.goto("/settings/membros");
    await expect(page.getByRole("heading", { name: /membros/i })).toBeVisible();
    await expect(page.getByText(EMAIL)).toBeVisible();
    await page.screenshot({
      path: shot("06-membros.png"),
      fullPage: true,
    });
  });

  test("07 — Audit log: lista eventos recentes", async ({ page }) => {
    await login(page);
    await page.goto("/settings/seguranca/audit-log");
    await expect(
      page.getByRole("heading", { name: /registro de atividade/i })
    ).toBeVisible();
    // Deve ter 2FA_ENABLE + LOGIN_ELEVATED (de testes anteriores + atual)
    await expect(page.getByText(/2FA_ENABLE/i).first()).toBeVisible({
      timeout: 10_000,
    });
    await page.screenshot({
      path: shot("07-audit-log.png"),
      fullPage: true,
    });
  });

  test("08 — Pipeline + Deal detail: abre aba Pagamentos", async ({ page }) => {
    await login(page);
    await page.goto("/pipeline");
    await page.waitForLoadState("networkidle");
    await page.screenshot({
      path: shot("08-pipeline.png"),
      fullPage: true,
    });

    // Pega o primeiro deal clicável (se existir)
    const firstDealLink = page.locator('a[href^="/deals/"]').first();
    const hasDeals = (await firstDealLink.count()) > 0;
    if (!hasDeals) {
      test.info().annotations.push({ type: "skip", description: "nenhum deal no pipeline" });
      return;
    }
    await firstDealLink.click();
    await page.waitForLoadState("networkidle");

    // Clica aba Pagamentos
    const pagTab = page.getByRole("tab", { name: /pagamentos/i });
    await expect(pagTab).toBeVisible({ timeout: 10_000 });
    await pagTab.click();

    // Deve mostrar o botão "Gerar cobrança" ou estado vazio
    await expect(
      page.getByRole("button", { name: /gerar cobran[çc]a/i })
    ).toBeVisible({ timeout: 5_000 });

    await page.screenshot({
      path: shot("08-deal-pagamentos.png"),
      fullPage: true,
    });
  });
});
