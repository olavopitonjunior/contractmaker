import {
  getDriveFolderId,
  getOwnerDriveClient,
  getServiceAccountEmail,
  isOwnerOAuthConfigured,
} from "./client";

/**
 * Converte um template Handlebars (`.hbs`) em um Google Doc nativo no Drive
 * da service account. O resultado é um doc visualmente idêntico ao template
 * atual, com placeholders no formato `{{flat.path_helperName}}` (compatível
 * com `flattenForGoogleDoc` em placeholders.ts) substituindo os helpers do
 * Handlebars.
 *
 * Estratégia em 4 passos:
 *  1. Substitui invocações de helpers (`{{moeda x}}`, `{{cpf x}}`,
 *     `{{dataExtenso x}}`) por placeholders flat no source `.hbs`.
 *  2. Substitui invocações simples (`{{x}}`, `{{this.x}}`) idem.
 *  3. Roda Handlebars com dados "permissivos" (todos os conditionals true,
 *     todos os each iteram 1×) — o resultado é HTML com `{{flat.placeholders}}`
 *     na posição correta de cada campo.
 *  4. Faz upload no Drive como `application/vnd.google-apps.document`.
 *
 * Limitações conhecidas (esperadas — exigem polimento manual no doc):
 *  - Loops `{{#each}}` produzem 1 instância: contratos com 2 vendedores
 *    precisarão duplicar o bloco no Google Doc manualmente, ou usar a Docs
 *    API `insertText` em vez de placeholders fixos.
 *  - Helpers `{{percentual a b}}` (multi-arg) são reduzidos a `{{a_pct}}`.
 *  - `{{else}}` em condicionais cai pelo lado true (porque dados são truthy).
 */

interface MigrateInput {
  templateSource: string;
  templateName: string;
  parentFolderId?: string;
}

interface MigrateOutput {
  googleDocId: string;
  webViewLink: string;
}

const HELPER_FLAT_SUFFIX: Record<string, string> = {
  moeda: "_moeda",
  extenso: "_extenso",
  numeroExtenso: "_extenso",
  cpf: "_fmt",
  cnpj: "_fmt",
  cep: "_fmt",
  dataExtenso: "_extenso",
  numero: "",
  percentual: "_pct",
};

const PH_OPEN = "GDPH";
const PH_CLOSE = "GDPH";

/** Pré-processa source `.hbs` substituindo helpers por placeholders flat. */
export function preProcessHbsForGoogleDoc(source: string): string {
  let out = source;

  // 1. Helpers conhecidos com 1 argumento: {{moeda path}} → __PH__path_moeda__
  // (skip `this.*` — esses são contextuais e tratados em collapseInnerEach)
  out = out.replace(
    /\{\{\s*(moeda|extenso|numeroExtenso|cpf|cnpj|cep|dataExtenso)\s+(?!this\.)([\w.]+(?:\.[\w.]+)*)\s*\}\}/g,
    (_, helper, path) => {
      const flatPath = pathToFlat(path) + HELPER_FLAT_SUFFIX[helper];
      return `${PH_OPEN}${flatPath}${PH_CLOSE}`;
    }
  );

  // 2. {{numero path}} ou {{numero path 2}} → __PH__path__
  out = out.replace(
    /\{\{\s*numero\s+(?!this\.)([\w.]+(?:\.[\w.]+)*)(?:\s+\d+)?\s*\}\}/g,
    (_, path) => `${PH_OPEN}${pathToFlat(path)}${PH_CLOSE}`
  );

  // 3. {{percentual a b}} → __PH__a_pct__
  out = out.replace(
    /\{\{\s*percentual\s+(?!this\.)([\w.]+(?:\.[\w.]+)*)\s+[\w.]+(?:\.[\w.]+)*\s*\}\}/g,
    (_, a) => `${PH_OPEN}${pathToFlat(a)}_pct${PH_CLOSE}`
  );

  // 4. {{path}} simples (não-bloco, não-helper, não-this) → __PH__path__
  out = out.replace(
    /\{\{\s*([\w][\w.]*)\s*\}\}/g,
    (full, path) => {
      // skip Handlebars built-ins, this.* e @-vars (deixam pra collapseInnerEach)
      if (
        path === "this" ||
        path.startsWith("this.") ||
        path.startsWith("@") ||
        ["else"].includes(path)
      ) {
        return full;
      }
      return `${PH_OPEN}${pathToFlat(path)}${PH_CLOSE}`;
    }
  );

  return out;
}

function pathToFlat(p: string): string {
  return p.replace(/\.this\./g, ".").replace(/^this\./, "");
}


/**
 * Resolve blocos `{{#if}}` / `{{#each}}` 100% no source, sem rodar Handlebars.
 * Para "modelo permissivo" tomamos sempre a branch IF, removemos `{{else}}`
 * blocks, e cada `{{#each}}` rende 1 iteração com placeholders contextuais.
 */
function resolveBlocksInSource(source: string): string {
  let prev = "";
  let curr = source;
  // Aplica até estabilizar (cobre nesting moderado).
  while (prev !== curr) {
    prev = curr;
    curr = collapseInnerEach(curr);
    curr = collapseInnerIf(curr);
  }
  return curr;
}

function collapseInnerIf(source: string): string {
  // Acha o {{#if ...}} mais interno (sem outro #if entre ele e seu /if).
  const re = /\{\{#if[^}]*\}\}((?:(?!\{\{#if).)*?)\{\{\/if\}\}/s;
  return source.replace(re, (_, body: string) => {
    const elseIdx = body.indexOf("{{else}}");
    if (elseIdx >= 0) {
      // Toma a parte antes do {{else}}
      return body.slice(0, elseIdx);
    }
    return body;
  });
}

function collapseInnerEach(source: string): string {
  const re = /\{\{#each\s+([\w.]+)\}\}((?:(?!\{\{#each).)*?)\{\{\/each\}\}/s;
  return source.replace(re, (_, name: string, body: string) => {
    const flatName = pathToFlat(name) + "1";
    let replaced = body.replace(/\{\{\s*this\.([\w.]+)\s*\}\}/g, (_, p) => {
      return `${PH_OPEN}${flatName}.${p}${PH_CLOSE}`;
    });
    replaced = replaced.replace(
      /\{\{\s*(moeda|extenso|numeroExtenso|cpf|cnpj|cep|dataExtenso|numero)\s+this\.([\w.]+)\s*\}\}/g,
      (_, helper, p) => {
        return `${PH_OPEN}${flatName}.${p}${HELPER_FLAT_SUFFIX[helper as keyof typeof HELPER_FLAT_SUFFIX]}${PH_CLOSE}`;
      }
    );
    // {{this}} sozinho dentro de each
    replaced = replaced.replace(/\{\{\s*this\s*\}\}/g, `${PH_OPEN}${flatName}${PH_CLOSE}`);
    return replaced;
  });
}

/** Converte placeholders sentinel para `{{flat.path}}` final. */
function postProcessPlaceholders(html: string): string {
  const open = PH_OPEN.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const close = PH_CLOSE.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  return html.replace(new RegExp(`${open}([^${close}]*?)${close}`, "g"), "{{$1}}");
}

/** Compila template para HTML com placeholders flat — usado pelo upload. */
export function buildPlaceholderHtml(templateSource: string): string {
  // 1. Substitui invocações simples por sentinels
  const preProcessed = preProcessHbsForGoogleDoc(templateSource);
  // 2. Resolve {{#if}}, {{#each}} colapsando para forma flat
  const collapsed = resolveBlocksInSource(preProcessed);
  // 3. Limpeza final: remove qualquer Handlebars residual
  const cleaned = stripHandlebarsLeftovers(collapsed);
  // 4. CLAUSE_SLOT comments → texto visível (Drive remove HTML comments no import)
  const slotsVisible = cleaned.replace(
    /<!--\s*CLAUSE_SLOT:(\w+)\s*-->/g,
    `<p>[[CLAUSE_SLOT_$1]]</p>`
  );
  // 5. Sentinels → {{flat.path}}
  const final = postProcessPlaceholders(slotsVisible);
  return wrapAsCompleteHtml(final);
}

function stripHandlebarsLeftovers(s: string): string {
  // Remove blocos órfãos não-resolvidos (helpers desconhecidos, by example).
  return s
    .replace(/\{\{!--[\s\S]*?--\}\}/g, "") // comments
    .replace(/\{\{else\}\}[\s\S]*?(?=\{\{\/(?:if|each|unless))/g, ""); // resíduo de else
}

function wrapAsCompleteHtml(body: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Modelo de Contrato</title>
</head>
<body>
${body}
</body>
</html>`;
}

/** Faz upload do HTML como Google Doc nativo no Drive. Cria como owner (você)
 *  e compartilha com SA como Editor. SA não pode possuir storage sem Workspace. */
export async function migrateTemplateToGoogleDoc(
  input: MigrateInput
): Promise<MigrateOutput> {
  const html = buildPlaceholderHtml(input.templateSource);

  if (!isOwnerOAuthConfigured()) {
    throw new Error(
      "GOOGLE_OWNER_REFRESH_TOKEN não configurado. Rode `scripts/oauth-bootstrap.ts`."
    );
  }
  const drive = getOwnerDriveClient();
  const parents = input.parentFolderId
    ? [input.parentFolderId]
    : (() => {
        const f = getDriveFolderId();
        return f ? [f] : undefined;
      })();

  const created = await drive.files.create({
    requestBody: {
      name: input.templateName,
      mimeType: "application/vnd.google-apps.document",
      ...(parents ? { parents } : {}),
    },
    media: {
      mimeType: "text/html",
      body: html,
    },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });

  const id = created.data.id;
  if (!id) throw new Error("Drive não retornou id do doc criado.");

  // Compartilha com SA para ela poder fazer ops de Docs API depois.
  const saEmail = getServiceAccountEmail();
  if (saEmail) {
    try {
      await drive.permissions.create({
        fileId: id,
        requestBody: { type: "user", role: "writer", emailAddress: saEmail },
        sendNotificationEmail: false,
        supportsAllDrives: true,
      });
    } catch (err) {
      console.error("[migrateTemplateToGoogleDoc] Falha ao compartilhar com SA:", err);
    }
  }

  return {
    googleDocId: id,
    webViewLink:
      created.data.webViewLink || `https://docs.google.com/document/d/${id}/edit`,
  };
}
