import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { EmailLayout, withEmailBrand, PLATFORM_BRAND } from "../templates/shared";

/**
 * O header do e-mail era o texto "Contractmaker" hardcoded — TODA cobrança que
 * ia pro cliente da imobiliária saía assinada com o nome da plataforma.
 *
 * A marca entra por AsyncLocalStorage (React Context não existe no bundle
 * `react-server` do Next — usá-lo derrubou o build). Estes testes travam o
 * contrato: dentro do escopo, sai a marca do tenant; fora dele, a da plataforma.
 */

const REMAX = {
  displayName: "RE/MAX Ativa",
  logoUrl: "https://blob/logo.png",
  primaryColor: "#DC1C2E",
  supportEmail: "wesleycapozzi@remax.com.br",
};

function sample() {
  return (
    <EmailLayout title="Cobrança emitida">
      <p>Sua cobrança está disponível.</p>
    </EmailLayout>
  );
}

describe("marca no e-mail", () => {
  it("dentro do escopo, o e-mail sai assinado pela imobiliária", async () => {
    const html = await withEmailBrand(REMAX, () => render(sample()));

    expect(html).toContain("https://blob/logo.png");
    expect(html).toContain("RE/MAX Ativa");
    expect(html).toContain("#DC1C2E");
    expect(html).toContain("wesleycapozzi@remax.com.br");
    // O nome da plataforma não pode assinar o e-mail de um tenant.
    expect(html).not.toContain("Contractmaker");
  });

  it("sem logo, o nome da imobiliária assume o lugar dele", async () => {
    const html = await withEmailBrand({ ...REMAX, logoUrl: null }, () => render(sample()));

    expect(html).toContain("RE/MAX Ativa");
    expect(html).not.toContain("<img");
  });

  it("fora do escopo (e-mail de plataforma: reset de senha, OTP), vale a marca do produto", async () => {
    const html = await render(sample());

    expect(html).toContain(PLATFORM_BRAND.displayName);
    expect(html).not.toContain("RE/MAX Ativa");
  });

  it("escopos concorrentes não vazam marca um pro outro", async () => {
    // O motivo de ALS e não de uma variável de módulo: dois envios em paralelo
    // (notifications manda em loop por destinatário) não podem trocar de marca.
    const [a, b] = await Promise.all([
      withEmailBrand(REMAX, () => render(sample())),
      withEmailBrand({ ...REMAX, displayName: "RE/MAX Trio", logoUrl: null }, () =>
        render(sample())
      ),
    ]);

    expect(a).toContain("RE/MAX Ativa");
    expect(a).not.toContain("RE/MAX Trio");
    expect(b).toContain("RE/MAX Trio");
    expect(b).not.toContain("https://blob/logo.png");
  });
});
