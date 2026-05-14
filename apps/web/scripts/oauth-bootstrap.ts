/**
 * Faz o flow OAuth do owner (você) para obter um refresh_token usado pelo
 * runtime do app criar Google Docs no seu Drive.
 *
 * 3 formas de passar credenciais (em ordem de prioridade):
 *
 *   1) Arquivo JSON baixado do Console (modo legado — Google removeu o
 *      download direto em 2026, mas se você tem um JSON antigo guardado
 *      ainda funciona):
 *        npx ts-node scripts/oauth-bootstrap.ts \
 *          --clientFile=C:\Users\User\.gcp\oauth-client.json
 *
 *   2) Flags --clientId e --clientSecret:
 *        npx ts-node scripts/oauth-bootstrap.ts \
 *          --clientId=247409780710-xxx.apps.googleusercontent.com \
 *          --clientSecret=GOCSPX-xxx
 *
 *   3) Env vars GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET
 *      (ex.: `vercel env pull` cria .env.local e você roda `dotenv -e .env.local --
 *      npx ts-node scripts/oauth-bootstrap.ts`):
 *        $env:GOOGLE_OAUTH_CLIENT_ID="247409780710-..."
 *        $env:GOOGLE_OAUTH_CLIENT_SECRET="GOCSPX-..."
 *        npx ts-node scripts/oauth-bootstrap.ts
 *
 * Sai com sucesso quando recebe o callback e imprime as 3 vars que você
 * cola em .env e Vercel:
 *   GOOGLE_OWNER_REFRESH_TOKEN=...
 *   GOOGLE_OAUTH_CLIENT_ID=...
 *   GOOGLE_OAUTH_CLIENT_SECRET=...
 */
import fs from "fs";
import http from "http";
import { URL } from "url";

const PORT = 8089;
const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "openid",
  "email",
];

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found?.slice(prefix.length);
}

function resolveCreds(): { clientId: string; clientSecret: string; source: string } {
  // Prioridade 1: arquivo JSON (compat com fluxos antigos)
  const clientFile = arg("clientFile");
  if (clientFile) {
    const raw = JSON.parse(fs.readFileSync(clientFile, "utf-8"));
    const installed = raw.installed || raw.web;
    if (!installed?.client_id || !installed?.client_secret) {
      throw new Error(
        `Arquivo ${clientFile} não tem client_id/client_secret em installed/web. Verifique o formato.`
      );
    }
    return {
      clientId: installed.client_id,
      clientSecret: installed.client_secret,
      source: `arquivo ${clientFile}`,
    };
  }

  // Prioridade 2: flags
  const cliId = arg("clientId");
  const cliSecret = arg("clientSecret");
  if (cliId && cliSecret) {
    return { clientId: cliId, clientSecret: cliSecret, source: "flags --clientId/--clientSecret" };
  }

  // Prioridade 3: env vars
  const envId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const envSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (envId && envSecret) {
    return {
      clientId: envId,
      clientSecret: envSecret,
      source: "env GOOGLE_OAUTH_CLIENT_ID/CLIENT_SECRET",
    };
  }

  throw new Error(
    [
      "Credenciais OAuth não encontradas. Use uma das opções:",
      "  1) --clientFile=path/oauth-client.json (se você tem o JSON baixado)",
      "  2) --clientId=... --clientSecret=...",
      "  3) Env vars GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET",
      "",
      "Se você não tem o secret salvo, pode pegar do Vercel via:",
      "  vercel env pull .env.vercel-prod",
      "  $env:GOOGLE_OAUTH_CLIENT_ID=$(Select-String 'GOOGLE_OAUTH_CLIENT_ID' .env.vercel-prod | %% { ($_ -split '=', 2)[1].Trim('\"') })",
      "  $env:GOOGLE_OAUTH_CLIENT_SECRET=$(Select-String 'GOOGLE_OAUTH_CLIENT_SECRET' .env.vercel-prod | %% { ($_ -split '=', 2)[1].Trim('\"') })",
    ].join("\n")
  );
}

async function main() {
  const { clientId, clientSecret, source } = resolveCreds();
  console.log(`Credenciais OAuth carregadas de: ${source}`);
  const redirectUri = `http://localhost:${PORT}/callback`;

  const authUrl =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
    }).toString();

  console.log("\n=== ABRA ESTA URL NO BROWSER ===\n");
  console.log(authUrl);
  console.log(`\nListening on http://localhost:${PORT}/callback ...\n`);

  const code: string = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url) return;
      const u = new URL(req.url, `http://localhost:${PORT}`);
      if (u.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const c = u.searchParams.get("code");
      const err = u.searchParams.get("error");
      if (err) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h1>Erro: ${err}</h1>`);
        server.close();
        reject(new Error(err));
        return;
      }
      if (!c) {
        res.writeHead(400);
        res.end("missing code");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h1>OK — pode fechar essa aba.</h1>");
      server.close();
      resolve(c);
    });
    server.on("error", reject);
    server.listen(PORT);
  });

  console.log(`Code recebido. Trocando por refresh_token…`);

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });

  if (!tokenRes.ok) {
    const t = await tokenRes.text();
    console.error("Token exchange falhou:", tokenRes.status, t);
    process.exit(1);
  }

  const tokens = await tokenRes.json();
  if (!tokens.refresh_token) {
    console.error(
      "Sem refresh_token retornado. Talvez você já tenha autorizado antes — revogue em https://myaccount.google.com/connections e tente de novo."
    );
    process.exit(1);
  }

  console.log("\n=== ✓ SUCESSO. Cola no .env ===\n");
  console.log(`GOOGLE_OAUTH_CLIENT_ID=${clientId}`);
  console.log(`GOOGLE_OAUTH_CLIENT_SECRET=${clientSecret}`);
  console.log(`GOOGLE_OWNER_REFRESH_TOKEN=${tokens.refresh_token}`);
}

main().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});
