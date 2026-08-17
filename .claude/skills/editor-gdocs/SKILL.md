---
name: editor-gdocs
description: Editor de contrato em Google Docs embedado (iframe Drive, comentários, suggestions, aba Configurações), templates Handlebars v2 CCV, DocumentStyle/design system, export PDF/DOCX e import de CCV pronto. Use ao mexer em ContractEditorPage, GoogleDocsEditor, lib/google/*, uploadHtmlAsGoogleDoc, contract-generation, templates .hbs, sync-templates, DocumentStyle, exporter/Puppeteer, ou import/re-extração de contrato.
---

# Editor Google Docs, templates, estilo e export

## Templates v2 (CCV Zimmermann)

`templates/`:
- **`ccv_a_vista_v2.hbs`** (15 cláusulas): sinal + saldo próprio · posse após pagto integral · escritura pública
- **`ccv_financiamento_v2.hbs`** (17 cláusulas): sinal + financiamento · posse após registro · 45 dias úteis · 9.5 rescisão por não-obtenção do crédito

**Layout** (validado vs v1): `<h1>INSTRUMENTO...</h1>` + `<h2>Modalidade: …</h2>` + separador `❦`. Sem cover-page. Bloco intermediadora: `{{#if comissao.comissionados.length}}` loop multi-corretora + fallback `{{#if (eq comissao.corretora_tipo_pessoa "fisica")}}`. Parcelas: à vista `{{this.letra}})`; financiamento `Parcela {{this.numero}}.` (`enrichContractData`). Slots `<!-- CLAUSE_SLOT:Gx -->` (Drive descarta).

**Form → template bridges:** `enrichContractData` mapeia top-level do form Zod pra `config.*` dos templates + textos derivados de parcelas/comissionados. Detalhes na memória `project_form_template_bridges`; labels em `lib/forms/payment-labels.ts`.

**Sync DB obrigatório:** mudanças nos `.hbs` SÓ afetam contratos novos depois de `pnpm tsx apps/web/scripts/sync-templates.ts --apply`. `ContractTemplate.handlebarsSource` é source-of-truth. Flags `--seed`, `--update-metadata`.

**Default por (orgId, modalidade):** invariant — `POST/PATCH /api/templates` faz `updateMany { isDefault: false }` antes. UI `/templates` mostra "Padrão atual" + `_count.contracts` + Arquivados. Versão congela `templateId`.

**Engine:** `handlebars` (default, suporta loops/conditionals/slots) ou `google_docs` (`copyContractGoogleDoc` + `replacePlaceholdersInDoc` flat — NÃO suporta `{{#each}}`/`{{#if}}`).

**Preview:** `POST /api/templates/[id]/preview` renderiza contra `lib/templates/preview-sample-data.ts`, sobe via `uploadHtmlAsGoogleDoc`, cacheia `googleTemplateDocId` + `previewSourceHash` (zerado em PATCH quando `handlebarsSource` muda). Scripts: `audit-templates.ts` (read-only), `archive-legacy-templates.ts`.

## Editor — Google Docs

`ContractEditorPage.tsx` orquestra: `GoogleDocsEditor.tsx` (iframe Drive) + header badges + Sheets (Comments/Versions/ChangeLog) + `SuggestionsToolbar` + ChatPanel + **ContractSettingsPanel** + Export/ShareDialog. Sem editor JS local. Contrato sem `googleDocId` (legado) mostra banner com CTA pra recriar.

**Aba Configurações** (ResizableSheet ao lado do Chat): foro, desistência, local/data de assinatura e multas/juros/prazos — saíram do form público (decisão da imobiliária, não do cliente). Padrão por org em `OrgFormSettings.contractDefaultsJson` (`{venda,locacao}` — `foro` é enum em venda e comarca em locação), aplicado por `enrichContractData` (fallback `DEFAULT_CONTRACT_SETTINGS` em `lib/contracts/default-config.ts`, alinhado ao texto que os templates já praticavam). `PATCH /api/contracts/[id]/settings` renderiza antes/depois e aplica só os parágrafos alterados via `replaceAllText` (diff LCS; alvo ambíguo ou editado à mão → reporta `not_found`, não muta). `buildSettingsPatch` grava as pontes `config.*` — sem elas o dataJson enriquecido não muda o texto.

**Pipelines:**
- **Criação (Handlebars):** `contract-generation.ts` → `renderContratoHTML` → `uploadHtmlAsGoogleDoc` (owner OAuth + share com SA) → `googleApplyStylePreset`
- **Import:** `contract-import.ts` → `uploadFileAsGoogleDoc` (Drive converte PDF/DOCX → Doc) → `extractCcvDataJson` → Contract `templateId: null`. NÃO aplica DocumentStyle
- **Versão `/version`:** `exportDocAsHtml` snapshot + `copyContractGoogleDoc` + reaplica DocumentStyle + novo watch
- **Aprovação `/approve`:** `exportDocAsHtml` antes de `status=aprovado`, atualiza `Contract.htmlContent` — snapshot pro `createContractMemory` indexar embedding

**GDocs runtime:** iframe `docs.google.com/document/d/{id}/edit?embedded=true&rm=embedded` (read-only `/preview` quando aprovado). **`ensureAnyonePermission`** em uploads aplica `anyone with link` (writer rascunho, reader após aprovação via `makeDocReadOnly`) — iframe abre sem "Solicitar acesso" com multi-conta Google no Chrome. URL só é entregue após `auth()` (rotas públicas não expõem). Backfill 1x: `scripts/backfill-anyone-permission.ts --apply`. "Compartilhar" via `ShareDialog.tsx` → `/api/contracts/[id]/share` (POST bloqueado em aprovado). Tools usam `safeGoogleCall` → `{error, googleApiError:true}`. Auto-save off; watch em `/api/webhooks/google-drive` popula `ContractChangeLog`. `SuggestionsToolbar` aplica `replaceAllText`/`deleteContentRange`/`insertText` via `PATCH /suggestions/[id]`. `CommentsPanel` com `requireSelectedTextInput=true` valida via `createAnchoredComment` (422 se trecho não existir). Banner `CloudOff` em `googleDocStatus.startsWith("error:")`. Migração legada: `scripts/migrate-tiptap-to-gdocs.ts --dealId <id> --apply`.

**Comentários e suggestions:** `ContractComment { authorType, severity, anchorId, selectedText, parentId, dedupeKey, resolved }` e `ContractSuggestion { type, suggestionId, status: pending|accepted|rejected }`. Endpoints `GET/POST /api/contracts/[id]/{comments,suggestions}` + `PATCH/DELETE`. Em GDocs, `add_comment` e `propose_suggestion` espelham no Drive Comments API; PATCH aplica no doc real e fecha thread.

## Design System (DocumentStyle)

`DocumentStyle { fontFamily, fontSizeBase, lineHeight, marginTopMm/Bottom/Left/Right, colorPrimary, colorAccent, headerHtml, footerHtml, pageNumbers, includeToc }`. UI `/settings/document-styles` com preview ao vivo.

**Preset default obrigatório** pra Handlebars: row `isDefault=true`. Em prod o "Padrão Zimmermann" (id `cmot43tt30001126r97zhcm3z`): EB Garamond, fontSizeBase 11, lineHeight 1.5, margens 30mm. Sem default, GDocs nascem Arial 11pt.

**Aplicação automática (Handlebars):** `contract-generation.ts` chama `googleApplyStylePreset` após upload (falha não bloqueia); `/version` reaplica após `copyContractGoogleDoc`. Via Docs API: `updateTextStyle` (font/size/cor), `updateParagraphStyle` (lineSpacing/alignment), `updateDocumentStyle` (margens).

**CENTER seletivo:** body `JUSTIFIED`. Centraliza apenas: HEADING_1 (sempre), **primeiro** HEADING_2 ("Modalidade: …"), parágrafos só com símbolos decorativos (regex `/^[❦◆◇●○•★※\s_*-]+$/`, length<10). Cláusulas em HEADING_2 ficam justified. **Contratos importados:** preset NÃO é aplicado.

Export PDF: `/api/contracts/[id]/export` carrega preset default da org → Puppeteer aplica `margin/headerTemplate/footerTemplate`. `<span class="pageNumber">/<span class="totalPages">` no footer default. GDocs mode usa `drive.files.export` nativo.

## Export PDF/DOCX

**Chromium serverless:** `lib/render/exporter.ts::launchBrowser()` detecta env via `VERCEL`/`AWS_LAMBDA_FUNCTION_NAME` e usa `@sparticuz/chromium` + `puppeteer-core`. Local: Chrome do sistema. **Sem fallback `puppeteer` full** (tenta baixar Chrome em runtime → quebra em serverless). `next.config.js::serverComponentsExternalPackages` inclui ambos — Next deixa como `require` runtime.

- **PDF margins:** Puppeteer é única fonte de verdade — defaults 30/25/35/25mm. `wrapWithStyle()` NÃO injeta `@page { margin }`
- **DOCX:** `html-to-docx` ignora CSS de classes. `htmlForDocx(html, style)` injeta inline via regex. Limitações: drop cap, ornamentos SVG, marca d'água, ligaturas não traduzem pra OOXML — perdidos. PDF preserva
- **Storage:** prioridade `BLOB_READ_WRITE_TOKEN` → `S3_BUCKET` → local `public/exports/` (só dev). Sem nenhum em serverless: erro PT-BR
- **GDocs mode** (`googleDocId` set): `drive.files.export` nativo, ignora preset
- Puppeteer requer Vercel Pro (timeout 60s)

## Import de contrato

`POST /api/deals/import-contract` (multipart, `runtime: nodejs`, `maxDuration: 60`): `file` (PDF/DOCX, ≤20MB) + `title?`. Valida header binário (PDF magic `%PDF-1.` / ZIP magic `50 4B 03 04`) → Vercel Blob → cria SalesForm `vinculado` + Deal "Confecção de Contrato" + DealAttachment → `importContractFromFile` → audit `CONTRACT_IMPORT`.

`importContractFromFile`: `uploadFileAsGoogleDoc` → `watchFile` (best-effort) → `exportDocAsHtml` (snapshot em `Contract.htmlContent`) → `extractCcvDataJson` (Gemini, falha → `{}`) → atualiza `SalesForm.dataJson` → cria `Contract { templateId: null, googleDocId/Url, status: rascunho, version: 1 }` → atualiza Deal title/value via `deriveDealMetadata`.

**Re-extração:** `POST /api/contracts/[id]/re-extract` rebusca o anexo original e refaz Gemini. Botão "Re-extrair dados" quando `templateId=null`. Audit `CONTRACT_REEXTRACT`.

**Prompt CCV** (`lib/extraction/ccv-extractor.ts`): força `comissao.comissionados[]` array sempre + `pagamento.parcelas[]` sequencial. `comissao.corretora_*` mantido por retrocompat — `comissionados` é canônico. Heurística modalidade: `financiamento` quando há menção a financiamento bancário/FGTS/cessão de consórcio.

**`Contract.templateId` nullable:** código null-safe; orgId via `deal.pipeline.orgId`. `/render` e `/contract-pdf` erram quando `templateId === null` sem `googleDocId`.

## Upload de imagens

`/api/contracts/[id]/images`: 5MB max, JPEG/PNG/WebP. Requer `BLOB_READ_WRITE_TOKEN`.
