/**
 * Diagnóstico do `code 604` ("Não foi possível decriptar os parâmetros")
 * retornado pelo Infosimples ao chamar tribunal/tjsp/pedido-civel com
 * pkcs12_cert + pkcs12_pass.
 *
 * Passos:
 *   1. Carrega env vars de apps/web/.env.vercel-prod.clean
 *   2. Valida localmente que INFOSIMPLES_PKCS12_CERT_BASE64 + INFOSIMPLES_PKCS12_PASSWORD
 *      decriptam o .pfx via node:tls.createSecureContext (mesmo OpenSSL)
 *   3. Faz 4 chamadas em paralelo com variações de envio:
 *        A) URL-encoded (baseline, igual o código atual)
 *        B) multipart/form-data com base64 string
 *        C) multipart/form-data com cert binário (sem base64)
 *        D) URL-encoded com base64 URL-safe (+ → -, / → _)
 *   4. Imprime code/code_message/errors[] de cada variação lado a lado.
 *
 * Uso:
 *   pnpm tsx apps/web/scripts/diag-pkcs12-tjsp.ts
 *
 * Não faz nada destrutivo. Cada chamada Infosimples respeita billable=false
 * em erro 6xx (zero custo). Roda contra a API real (prod).
 */

import fs from "fs";
import path from "path";
import tls from "tls";

const ENV_FILES = [".env.vercel-prod.clean", ".env.vercel-prod", ".env"];
for (const name of ENV_FILES) {
  const p = path.resolve(__dirname, "..", name);
  if (!fs.existsSync(p)) continue;
  fs.readFileSync(p, "utf-8")
    .split("\n")
    .forEach((line) => {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(.*))$/);
      if (m && !process.env[m[1]]) {
        let v = (m[2] ?? m[3] ?? m[4] ?? "").trim();
        v = v.replace(/\\n/g, "");
        process.env[m[1]] = v;
      }
    });
  break;
}

const TOKEN = process.env.INFOSIMPLES_TOKEN;
const CERT_B64 = process.env.INFOSIMPLES_PKCS12_CERT_BASE64;
const CERT_PASS = process.env.INFOSIMPLES_PKCS12_PASSWORD;

if (!TOKEN || !CERT_B64 || !CERT_PASS) {
  console.error("Env vars ausentes:");
  console.error("  INFOSIMPLES_TOKEN:", TOKEN ? "set" : "MISSING");
  console.error("  INFOSIMPLES_PKCS12_CERT_BASE64:", CERT_B64 ? `set (${CERT_B64.length} chars)` : "MISSING");
  console.error("  INFOSIMPLES_PKCS12_PASSWORD:", CERT_PASS ? `set (${CERT_PASS.length} chars)` : "MISSING");
  process.exit(1);
}

const URL_ENDPOINT = "https://api.infosimples.com/api/v2/consultas/tribunal/tjsp/pedido-civel";

// Payload mínimo de teste — CPF do user (Olavo) pra evitar "consulta de terceiro"
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

// =============================================================================
// PASSO 1: validar localmente o .pfx
// =============================================================================
console.log("\n=== PASSO 1: validar .pfx localmente ===");
try {
  const pfxBuffer = Buffer.from(CERT_B64.trim(), "base64");
  console.log(`base64 → ${pfxBuffer.length} bytes`);
  console.log(`primeiros 4 bytes (hex): ${pfxBuffer.slice(0, 4).toString("hex")}`);
  // .pfx (PKCS#12) sempre começa com sequência DER 30 82 XX XX
  if (pfxBuffer[0] !== 0x30 || pfxBuffer[1] !== 0x82) {
    console.warn("⚠️  primeiros bytes NÃO são DER (30 82) — base64 pode estar corrompido");
  } else {
    console.log("✅ DER header ok");
  }

  // tls.createSecureContext valida o .pfx + senha (mesma engine do OpenSSL)
  const ctx = tls.createSecureContext({ pfx: pfxBuffer, passphrase: CERT_PASS });
  console.log("✅ tls.createSecureContext aceitou pfx + senha (decriptou OK)");
  void ctx;
} catch (err) {
  console.error("❌ falha local:", err instanceof Error ? err.message : err);
  console.error("   Causa provável: senha errada OU .pfx em formato exótico (PBKDF2 SHA-256/AES não-legado)");
  process.exit(1);
}

// =============================================================================
// PASSO 2: testar 4 variações
// =============================================================================
type Variant = {
  name: string;
  description: string;
  build: () => Promise<{ headers: Record<string, string>; body: Buffer | string }>;
};

async function variantA_urlencoded(): Promise<{ headers: Record<string, string>; body: Buffer | string }> {
  const body = new URLSearchParams();
  body.set("token", TOKEN!);
  body.set("timeout", "600");
  for (const [k, v] of Object.entries(TEST_PAYLOAD)) body.set(k, v);
  body.set("pkcs12_cert", CERT_B64!.trim());
  body.set("pkcs12_pass", CERT_PASS!);
  return {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  };
}

async function variantD_urlencoded_urlsafe(): Promise<{ headers: Record<string, string>; body: Buffer | string }> {
  const body = new URLSearchParams();
  body.set("token", TOKEN!);
  body.set("timeout", "600");
  for (const [k, v] of Object.entries(TEST_PAYLOAD)) body.set(k, v);
  // base64 URL-safe: + → -, / → _, = pode ser stripado mas mantenho
  const urlSafe = CERT_B64!.trim().replace(/\+/g, "-").replace(/\//g, "_");
  body.set("pkcs12_cert", urlSafe);
  body.set("pkcs12_pass", CERT_PASS!);
  return {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  };
}

async function variantB_multipart_base64(): Promise<{ headers: Record<string, string>; body: Buffer | string }> {
  const boundary = `----diag${Math.random().toString(36).slice(2)}`;
  const fields: Record<string, string> = {
    token: TOKEN!,
    timeout: "600",
    ...TEST_PAYLOAD,
    pkcs12_cert: CERT_B64!.trim(),
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
  return {
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: parts.join("\r\n"),
  };
}

async function variantC_multipart_binary(): Promise<{ headers: Record<string, string>; body: Buffer | string }> {
  const boundary = `----diag${Math.random().toString(36).slice(2)}`;
  const certBuffer = Buffer.from(CERT_B64!.trim(), "base64");
  const fields: Record<string, string> = {
    token: TOKEN!,
    timeout: "600",
    ...TEST_PAYLOAD,
    pkcs12_pass: CERT_PASS!,
  };
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  // pkcs12_cert como arquivo binário
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="pkcs12_cert"; filename="cert.pfx"\r\nContent-Type: application/x-pkcs12\r\n\r\n`
    )
  );
  chunks.push(certBuffer);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return {
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: Buffer.concat(chunks),
  };
}

const variants: Variant[] = [
  { name: "A_urlenc", description: "URL-encoded baseline (atual prod)", build: variantA_urlencoded },
  { name: "B_multi_b64", description: "multipart com base64 string", build: variantB_multipart_base64 },
  { name: "C_multi_bin", description: "multipart com cert binário (sem base64)", build: variantC_multipart_binary },
  { name: "D_urlenc_safe", description: "URL-encoded com base64 URL-safe", build: variantD_urlencoded_urlsafe },
];

async function callVariant(v: Variant) {
  const { headers, body } = await v.build();
  const t0 = Date.now();
  try {
    const res = await fetch(URL_ENDPOINT, { method: "POST", headers, body });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = { _raw: text.slice(0, 500) };
    }
    return {
      name: v.name,
      description: v.description,
      httpStatus: res.status,
      code: json.code,
      code_message: json.code_message,
      errors: json.errors,
      billable: json.header?.billable,
      latencyMs: Date.now() - t0,
    };
  } catch (err) {
    return {
      name: v.name,
      description: v.description,
      httpStatus: null,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - t0,
    };
  }
}

console.log("\n=== PASSO 2: testar 4 variações em paralelo ===");
console.log(`(timeout 600s configurado no body — pode demorar 1-3min cada)\n`);

(async () => {
  const results = await Promise.all(variants.map(callVariant));
  console.log("\n=== Resultados ===");
  for (const r of results) {
    console.log("─".repeat(60));
    console.log(`Variant: ${r.name} — ${r.description}`);
    console.log(`HTTP: ${r.httpStatus}  Latency: ${r.latencyMs}ms`);
    if ("error" in r) {
      console.log(`Network error: ${r.error}`);
    } else {
      console.log(`Infosimples code: ${r.code}`);
      console.log(`code_message: ${r.code_message}`);
      console.log(`errors: ${JSON.stringify(r.errors)}`);
      console.log(`billable: ${r.billable}`);
    }
  }
  console.log("─".repeat(60));
  console.log("\nInterpretação:");
  console.log("  - Se A retorna 604 mas B/C retornam diferente → problema é Content-Type");
  console.log("  - Se TODAS retornam 604 → problema é nome do parâmetro ou formato base64/senha");
  console.log("  - Se alguma retorna 200 ou 600/620 → achamos o shape correto");
})();
