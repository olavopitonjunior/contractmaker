import { NextRequest, NextResponse } from "next/server";
import tls from "tls";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const maxDuration = 660;

/**
 * GET /api/admin/diag/pkcs12-tjsp
 *
 * Diagnóstico do `code 604` que Infosimples retorna no tribunal/tjsp/pedido-civel
 * quando enviamos pkcs12_cert + pkcs12_pass.
 *
 * Fluxo:
 *   1. Valida que session.user é owner/admin
 *   2. Decodifica INFOSIMPLES_PKCS12_CERT_BASE64 e tenta abrir com a senha
 *      via tls.createSecureContext — confirma se o .pfx + senha são válidos
 *      do ponto de vista OpenSSL (mesma engine da Infosimples backend)
 *   3. Dispara 4 chamadas REAIS em paralelo contra Infosimples com variações
 *      de envio do cert:
 *        A) URL-encoded baseline (formato atual)
 *        B) multipart com base64 string
 *        C) multipart com cert binário (sem base64)
 *        D) URL-encoded com base64 URL-safe (+ → -, / → _)
 *   4. Retorna code/code_message/errors[]/billable de cada variação
 *
 * NUNCA retorna o cert nem a senha no response. Custo: zero (Infosimples
 * respeita billable=false em códigos 6xx). Latência: até 3min por variação
 * (timeout body=600s).
 */
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }
  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: session.user.id, orgId: org.id } },
  });
  const role = membership?.role ?? "viewer";
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const TOKEN = process.env.INFOSIMPLES_TOKEN;
  const CERT_B64 = process.env.INFOSIMPLES_PKCS12_CERT_BASE64?.trim();
  const CERT_PASS = process.env.INFOSIMPLES_PKCS12_PASSWORD;

  if (!TOKEN || !CERT_B64 || !CERT_PASS) {
    return NextResponse.json(
      {
        envCheck: {
          INFOSIMPLES_TOKEN: Boolean(TOKEN),
          INFOSIMPLES_PKCS12_CERT_BASE64: Boolean(CERT_B64),
          INFOSIMPLES_PKCS12_PASSWORD: Boolean(CERT_PASS),
        },
        error: "Env vars ausentes",
      },
      { status: 503 }
    );
  }

  // --- PASSO 1: validar .pfx + senha local ---
  const localCheck: {
    ok: boolean;
    bytes: number;
    derHeaderOk: boolean;
    decryptError?: string;
  } = { ok: false, bytes: 0, derHeaderOk: false };
  try {
    const pfxBuffer = Buffer.from(CERT_B64, "base64");
    localCheck.bytes = pfxBuffer.length;
    localCheck.derHeaderOk = pfxBuffer[0] === 0x30 && pfxBuffer[1] === 0x82;
    tls.createSecureContext({ pfx: pfxBuffer, passphrase: CERT_PASS });
    localCheck.ok = true;
  } catch (err) {
    localCheck.decryptError = err instanceof Error ? err.message : String(err);
  }

  if (!localCheck.ok) {
    // Se nem local decripta, não adianta testar contra Infosimples
    return NextResponse.json(
      { localCheck, hint: "Cert ou senha inválidos no próprio runtime — fix antes" },
      { status: 200 }
    );
  }

  // --- PASSO 2: 4 variações em paralelo ---
  const URL_ENDPOINT =
    "https://api.infosimples.com/api/v2/consultas/tribunal/tjsp/pedido-civel";

  // Payload mínimo — usa CPF do dono da org pra evitar "terceiro"
  const TEST_PAYLOAD = {
    cpf: "39276943803",
    nome: "OLAVO PITON",
    email: "contato@contractmaker.com.br",
    finalidade: "Instrucao de compra e venda de imovel",
    instancia: "1",
    tipo_certidao: "civel",
    pais: "Brasil",
    uf: "SP",
    municipio: "SAO PAULO",
  };

  type VariantResult = {
    name: string;
    description: string;
    httpStatus: number | null;
    code?: number;
    codeMessage?: string;
    errors?: unknown;
    billable?: boolean;
    latencyMs: number;
    networkError?: string;
  };

  async function callA_urlenc(): Promise<VariantResult> {
    const t0 = Date.now();
    const body = new URLSearchParams();
    body.set("token", TOKEN!);
    body.set("timeout", "600");
    for (const [k, v] of Object.entries(TEST_PAYLOAD)) body.set(k, v);
    body.set("pkcs12_cert", CERT_B64!);
    body.set("pkcs12_pass", CERT_PASS!);
    return doCall(
      "A_urlenc",
      "URL-encoded baseline (formato atual em prod)",
      { "Content-Type": "application/x-www-form-urlencoded" },
      body.toString(),
      t0
    );
  }

  async function callB_multi_b64(): Promise<VariantResult> {
    const t0 = Date.now();
    const boundary = `----diag${Math.random().toString(36).slice(2)}`;
    const fields: Record<string, string> = {
      token: TOKEN!,
      timeout: "600",
      ...TEST_PAYLOAD,
      pkcs12_cert: CERT_B64!,
      pkcs12_pass: CERT_PASS!,
    };
    const parts: string[] = [];
    for (const [k, v] of Object.entries(fields)) {
      parts.push(`--${boundary}`);
      parts.push(`Content-Disposition: form-data; name="${k}"`);
      parts.push("");
      parts.push(v);
    }
    parts.push(`--${boundary}--`);
    parts.push("");
    return doCall(
      "B_multi_b64",
      "multipart/form-data com base64 string",
      { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      parts.join("\r\n"),
      t0
    );
  }

  async function callC_multi_bin(): Promise<VariantResult> {
    const t0 = Date.now();
    const boundary = `----diag${Math.random().toString(36).slice(2)}`;
    const certBuffer = Buffer.from(CERT_B64!, "base64");
    const fields: Record<string, string> = {
      token: TOKEN!,
      timeout: "600",
      ...TEST_PAYLOAD,
      pkcs12_pass: CERT_PASS!,
    };
    const chunks: Buffer[] = [];
    for (const [k, v] of Object.entries(fields)) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`
        )
      );
    }
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="pkcs12_cert"; filename="cert.pfx"\r\nContent-Type: application/x-pkcs12\r\n\r\n`
      )
    );
    chunks.push(certBuffer);
    chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    return doCall(
      "C_multi_bin",
      "multipart/form-data com cert binário (sem base64)",
      { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      Buffer.concat(chunks),
      t0
    );
  }

  async function callD_urlenc_safe(): Promise<VariantResult> {
    const t0 = Date.now();
    const body = new URLSearchParams();
    body.set("token", TOKEN!);
    body.set("timeout", "600");
    for (const [k, v] of Object.entries(TEST_PAYLOAD)) body.set(k, v);
    body.set("pkcs12_cert", CERT_B64!.replace(/\+/g, "-").replace(/\//g, "_"));
    body.set("pkcs12_pass", CERT_PASS!);
    return doCall(
      "D_urlenc_safe",
      "URL-encoded com base64 URL-safe (+→-, /→_)",
      { "Content-Type": "application/x-www-form-urlencoded" },
      body.toString(),
      t0
    );
  }

  async function doCall(
    name: string,
    description: string,
    headers: Record<string, string>,
    body: Buffer | string,
    t0: number
  ): Promise<VariantResult> {
    try {
      const fetchBody: BodyInit =
        typeof body === "string"
          ? body
          : (new Uint8Array(body.buffer, body.byteOffset, body.byteLength) as unknown as BodyInit);
      const res = await fetch(URL_ENDPOINT, {
        method: "POST",
        headers,
        body: fetchBody,
        signal: AbortSignal.timeout(620_000),
      });
      const text = await res.text();
      let parsed: {
        code?: number;
        code_message?: string;
        errors?: unknown;
        header?: { billable?: boolean };
      };
      try {
        parsed = JSON.parse(text);
      } catch {
        return {
          name,
          description,
          httpStatus: res.status,
          codeMessage: `[non-json] ${text.slice(0, 300)}`,
          latencyMs: Date.now() - t0,
        };
      }
      return {
        name,
        description,
        httpStatus: res.status,
        code: parsed.code,
        codeMessage: parsed.code_message,
        errors: parsed.errors,
        billable: parsed.header?.billable,
        latencyMs: Date.now() - t0,
      };
    } catch (err) {
      return {
        name,
        description,
        httpStatus: null,
        networkError: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - t0,
      };
    }
  }

  const results = await Promise.all([
    callA_urlenc(),
    callB_multi_b64(),
    callC_multi_bin(),
    callD_urlenc_safe(),
  ]);

  return NextResponse.json({
    localCheck,
    results,
    interpretation: {
      ifAllSame604: "Problema é nome do parâmetro ou formato base64/senha — pedir shape exato pra Infosimples",
      ifAReturns604ButBOrCDiffers: "Problema é Content-Type — usar a variação que retornou diferente",
      ifAnyReturns200or600or620: "Achamos o shape correto — propagar pra callInfosimples",
    },
  });
}
