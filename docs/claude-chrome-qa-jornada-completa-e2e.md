# Roteiro E2E — Jornada completa do contrato (OCR · forms · upload · contrato · edição)

Roteiro de QA ponta-a-ponta reutilizável, dirigível via `/chrome` (Claude in Chrome) ou
manualmente. Criado para validar a branch
`worktree-melhorias-ocr-storage-obrigatoriedade` (melhorias de OCR/storage/obrigatoriedade/
arquivamento + fix de negócios duplicados + fix de "falha no upload" ao anexar), mas
estruturado como **checklist genérico replicável em outras etapas/cenários**.

> Formato de reporte (memória `feedback_qa_after_close`): para cada item, marcar
> **✅ ok / ❌ falhou / 🟡 parcial** + evidência (screenshot, id do deal, status HTTP).
> Ao final, montar um **punch list** com os ❌/🟡.

---

## 0. Objetivo

Recriar um contrato **já existente** (caso real "Cód 19503 Igor Imene (PG)") usando **os
mesmos documentos**, exercitando toda a jornada: import/upload → OCR/extração → formulário/
obrigatoriedade → contrato/informações → edição direta (Google Docs) → edição via chat
(agente IA) → arquivamento. Confirma que os bugs corrigidos não reaparecem e que o fluxo
feliz continua íntegro.

## 1. Pré-requisitos

| Item | Detalhe |
|---|---|
| Ambiente | **staging** (`https://staging.imobpro.ia.br`) com a branch **deployada** (ver §7). NÃO rodar contra prod com código antigo — reproduziria os bugs. |
| Login | Conta owner da org de teste (ex.: `olavo.piton@gmail.com`). 2FA se exigido. |
| Artefato 1 — CCV | O PDF original **"Cód 19503 Igor.pdf"** (~3.9 MB, escaneado). É o arquivo que disparou o timeout/duplicação. Pedir ao usuário se não disponível. |
| Artefato 2 — doc grande | Um PDF/imagem **6–8 MB** (ex.: matrícula escaneada multipágina) para testar o anexo client-direct (antes dava 413). |
| Artefato 3 — docs de parte | RG/CPF (imagem) + matrícula (PDF >2 págs) + comprovante — para OCR da pasta e da etapa 0 do form. |
| Artefato 4 — DOCX | Um CCV em **.docx** (para validar DOCX→PDF no import e re-extração). |
| Navegador | Chrome com a extensão (para `/chrome`). Multi-conta Google OK (iframe abre sem "Solicitar acesso"). |
| ClickSign | Opcional — assinatura é **produção real** (R$ 1,50/signer). Marcar a Fase I como opcional. |

**Rastreabilidade fix → fase** (o que cada fase valida desta branch):

| Fix | Fase |
|---|---|
| Import: `maxDuration` 60→300 + dedup `contentHash` (sem duplicar/órfão) | A |
| OCR: DOCX→PDF, re-extract por kind, limite de páginas (`OCR_MAX_PAGES`) | B |
| Anexo: upload client-direct pro Blob (sem 413) + dedup | C |
| Obrigatoriedade no servidor (hard-blocker na aprovação) + `customRequiredPaths` | D, E |
| Informações/registro (audit FORM_UPDATE no finalize) | D, E |
| Edição direta (ChangeLog) | F |
| Edição via chat (agente, Mudanças) | G |
| Arquivamento (`archivedAt` + botão + filtro kanban) | H |

---

## 2. Fase A — Recriar o contrato via "Cadastro rápido com upload" (import)

Entrada: `/pipeline` → "Novo negócio" → **Cadastro rápido com upload**
(`/deals/new-from-upload`).

| # | Passo | Resultado esperado | ✅/❌/🟡 |
|---|---|---|---|
| A1 | Subir **Artefato 1** (CCV 3.9 MB), stage destino "Contrato assinado", título "QA 19503 Igor". | Sem erro de timeout. Em **≤ 5 min** redireciona pro editor do contrato (antes estourava 60s → 504). |  |
| A2 | Observar o tempo até o editor abrir. | Conclui **< 300 s** (novo `maxDuration`). Sem 504. |  |
| A3 | Confirmar criação: 1 Deal + 1 SalesForm (`vinculado`) + 1 Contract (`templateId=null`, GDoc) + 1 DealAttachment `contrato_original`. | Tudo criado; editor mostra "Contrato importado". |  |
| A4 | **Repetir o A1 com o MESMO PDF** (simula o operador re-subindo achando que falhou). | **NÃO cria 2º negócio.** Resposta `deduped:true` → devolve o MESMO deal/contrato. (Antes: 3 deals duplicados.) |  |
| A5 | Verificar no kanban "Contrato assinado". | Aparece **um** card "QA 19503 Igor" (não 2–3). |  |
| A6 | (DB) Rodar a query §8.1. | 1 Deal com o título; 1 audit `CONTRACT_IMPORT` SUCCESS. |  |

## 3. Fase B — OCR / extração / re-extração

| # | Passo | Resultado esperado | ✅/❌/🟡 |
|---|---|---|---|
| B1 | Abrir aba **Dados** do contrato importado. | Campos extraídos pelo Gemini preenchidos (vendedor/comprador/imóvel/valor). |  |
| B2 | Clicar **"Re-extrair dados"**. | Re-roda a extração; `dataJson` atualiza; audit `CONTRACT_REEXTRACT`. |  |
| B3 | Repetir o import (Fase A) com **Artefato 4 (DOCX)** num deal novo. | `Contract.dataJson` vem **populado** (não `{}`). Valida DOCX→PDF antes do Gemini. |  |
| B4 | Num deal de **locação** importado (ver §4), clicar "Re-extrair". | Usa o extractor de **locação** (shape locadores/locatários), não o CCV de venda. |  |
| B5 | (Etapa 0 form) Em um form público, subir **matrícula >2 págs** + clicar "Extrair com IA". | Extrai dados além da página 2 (ônus/qualificação). Valida `OCR_MAX_PAGES`. |  |

## 4. Fase C — Upload de documentos na pasta do deal (anexos)

Aba **Documentos** do deal → card "Clique ou arraste arquivos aqui".

| # | Passo | Resultado esperado | ✅/❌/🟡 |
|---|---|---|---|
| C1 | Anexar **Artefato 2 (6–8 MB)**. | **Sucesso** ("documento adicionado"). (Antes: 413 → toast "falha no upload".) |  |
| C2 | (DevTools › Network) Inspecionar as requests do C1. | `POST /attachments/blob-upload` (handshake) + upload **direto** pro `*.blob.vercel-storage.com` + `POST /attachments/finalize` 201. Nenhuma 413. |  |
| C3 | Anexar o **mesmo** Artefato 2 de novo. | `deduped:true` (200); **não** cria 2ª linha; blob redundante removido. |  |
| C4 | Anexar **Artefato 3** (RG, matrícula, comprovante). | Todos aparecem na pasta, agrupados por parte/imóvel; baixáveis via `/file`. |  |
| C5 | Tentar anexar arquivo **> 10 MB**. | Bloqueado no cliente com "excede 10 MB" (não chega ao servidor). |  |
| C6 | (Negativo) Forjar `POST /attachments/finalize` com `url` de host externo. | **403** "URL não pertence a este negócio" (anti-SSRF). |  |

## 5. Fase D — Formulário público + obrigatoriedade no servidor

Usar o **2º ponto de entrada** (form público) para exercitar obrigatoriedade/geração:
`/pipeline` → "Novo negócio" → **Novo formulário** → abrir `/f/[token]`.

| # | Passo | Resultado esperado | ✅/❌/🟡 |
|---|---|---|---|
| D1 | (Admin) Em `/settings/formulario`, definir preset **"padrão"** (ou custom). | Salva; audit `FORM_SETTINGS_UPDATE`. |  |
| D2 | (Admin) Tentar adicionar `customRequiredPath` com path **órfão** (ex.: `vendedores.0.cpff`) ou `step:7`. | **Recusado** (400, "path desconhecido" / step inválido 0..6). |  |
| D3 | Preencher o form deixando um **required-path vazio** (ex.: `email` do vendedor no preset padrão) e finalizar. | Finaliza (cliente), gera contrato; audit **FORM_UPDATE** com `validationIssues`. |  |
| D4 | Abrir o contrato gerado e tentar **Aprovar**. | **Bloqueado** — ContractComment `severity=error` por campo obrigatório/formato; "Aprovar mesmo assim" **oculto** (`canForce=false`). |  |
| D5 | Preencher os campos, **regerar** e aprovar. | Nova versão sem os erros; aprovação passa. |  |
| D6 | Conferir que **contrato importado** (Fase A) **NÃO** é bloqueado por required-paths. | Importado aprova (isento de required-paths; cônjuge/formato ainda valem). |  |
| D7 | Form com cônjuge casado sem CPF / comissionados somando >100% / parcelas ≠ total. | Cada caso vira ContractComment `error` e trava aprovação. |  |

## 6. Fase E — Contrato / informações (aba Dados, espelho)

| # | Passo | Resultado esperado | ✅/❌/🟡 |
|---|---|---|---|
| E1 | Comparar a aba **Dados** com o conteúdo do CCV original. | Vendedor/comprador/imóvel/valor/comissão conferem com o documento. |  |
| E2 | Conferir o badge de IA/budget no header. | Coerente (cinza/âmbar/vermelho conforme uso). |  |
| E3 | Conferir Documentos: contrato_original presente; assinado aparecerá após a Fase I. | Pasta consistente. |  |

## 7. Fase F — Edição direta do contrato (Google Docs)

| # | Passo | Resultado esperado | ✅/❌/🟡 |
|---|---|---|---|
| F1 | No iframe do Doc, editar um trecho (ex.: corrigir um nome). | Edição persiste no Drive. |  |
| F2 | Abrir o painel **ChangeLog/Versões**. | A edição aparece registrada (`ContractChangeLog`, source do watch). |  |
| F3 | Usar a **SuggestionsToolbar** (replace/insert). | Aplica no doc real; thread fecha. |  |

## 8. Fase G — Edição via chat (agente IA)

| # | Passo | Resultado esperado | ✅/❌/🟡 |
|---|---|---|---|
| G1 | Abrir o **ChatPanel**, modo **Fast** (Haiku, edita direto). Ex.: "padronize a cláusula de foro". | Responde em ~3–5 s; aplica a edição; chips ao vivo. |  |
| G2 | Conferir o painel **Mudanças**. | Diff `htmlBefore/htmlAfter` da edição do chat. |  |
| G3 | Modo **Plan** (Sonnet): pedir uma alteração com write. | `propose_plan` antes do write; PlanCard com checkbox; "Executar plano" captura before/after. |  |
| G4 | Anexar um doc ao chat (PDF/URL) e pedir análise. | `ChatAttachment` processado (Gemini/stripper); resposta usa o anexo. |  |
| G5 | Pedir algo informativo ("o que diz a cláusula 5?"). | **Não** edita (regra 10.1); só responde. |  |

## 9. Fase H — Arquivamento + limpeza

| # | Passo | Resultado esperado | ✅/❌/🟡 |
|---|---|---|---|
| H1 | No deal de teste, clicar **Arquivar**. | Some do kanban; toast "Negócio arquivado"; audit `DEAL_ARCHIVED`. |  |
| H2 | Abrir o kanban com `?arquivados=1`. | O deal arquivado reaparece (recuperação). |  |
| H3 | No deal, clicar **Desarquivar**. | Volta ao kanban; audit `DEAL_UNARCHIVED`. |  |
| H4 | (Locação) Repetir H1–H3 no `LocacaoDealHeaderActions`. | Paridade com vendas. |  |
| H5 | Excluir os deals de teste criados (limpeza). | Deal + form + contratos + anexos removidos; **blobs apagados** (sem órfão). |  |

## 10. Fase I — Assinatura (OPCIONAL, ClickSign produção)

| # | Passo | Resultado esperado | ✅/❌/🟡 |
|---|---|---|---|
| I1 | Aprovar o contrato e enviar envelope (signers do dataJson). | Envelope criado; status running. |  |
| I2 | Assinar (signer real). | Webhook `close` → `signed.pdf` no storage → DealAttachment `contrato_assinado` (helper `persistSignedPdf`). |  |
| I3 | Rodar o botão **Atualizar** (sync). | Não duplica o anexo assinado (dedup url+contentHash). |  |

---

## 11. Deploy da branch pro staging (pré-requisito da execução)

A execução das fases roda contra **staging com esta branch**. Conforme o workflow
(CLAUDE.md / `docs/staging-workflow.md`) e as memórias de deploy:

1. Levar as mudanças pro branch **`staging`** (merge/cherry-pick de
   `worktree-melhorias-ocr-storage-obrigatoriedade` → `staging`, ou PR).
2. **Aplicar as migrações** (`prisma migrate deploy` roda no build): `..._deal_attachment_content_hash`, `..._deal_archived_at`.
3. Se o auto-deploy git travar (memória `feedback_staging_deploy_dns_gotchas` — autor sem
   acesso Vercel), forçar `vercel redeploy` sob o projeto `contractmaker-staging` (CLI
   `olavopiton-4477`).
4. Conferir env no staging: `BLOB_READ_WRITE_TOKEN` válido (memória
   `feedback_staging_blob_token_invalid`), `GEMINI_API_KEY`, OAuth Google, ClickSign.
5. Smoke rápido (carrega `/pipeline`, abre um deal) antes de iniciar o roteiro.

## 12. Verificações de apoio (DB / logs)

**12.1 — Sem duplicação no import (Neon, projeto ContractMaker `wispy-tree-00688100`):**
```sql
SELECT title, count(*) FROM "Deal"
WHERE title ILIKE '%19503%' GROUP BY title HAVING count(*) > 1;
-- esperado: 0 linhas (nenhum título duplicado)
```
**12.2 — Anexo com contentHash/byteSize:**
```sql
SELECT source, count(*), count("contentHash") AS com_hash, count("byteSize") AS com_size
FROM "DealAttachment" WHERE "dealId" = '<dealId>' GROUP BY source;
```
**12.3 — Audit do finalize/obrigatoriedade:**
```sql
SELECT action, result, metadata->>'validationIssueCount' AS issues, "createdAt"
FROM "AuditLog" WHERE action IN ('FORM_UPDATE','CONTRACT_IMPORT','DEAL_ARCHIVED')
ORDER BY "createdAt" DESC LIMIT 20;
```
**12.4 — Logs Vercel (sem 504/413):** `get_runtime_logs` filtrando `since=1h`,
`level=error` — confirmar ausência de `Task timed out` em `/api/deals/import-contract` e de
413 nas rotas de anexo.

## 13. Replicação em outras etapas / cenários

Reusar este roteiro trocando o **artefato e a modalidade**. Matriz mínima sugerida:

| Cenário | Troca | Foco extra |
|---|---|---|
| Venda **financiamento** | CCV com financiamento bancário/FGTS | G4 (cláusula de crédito) obrigatório; parcelas financiamento |
| **Locação** residencial | CCV/contrato de locação (`/locacao`) | extractor de locação (B4); presets de locação isentos; abas Seguros/Garantias/Vistoria |
| **Locação** comercial | finalidade comercial | rótulo do tipo de imóvel; foro |
| **Multi-parte** | 2 vendedores PF+PJ, cônjuges, procurador | remap PJ (cpf→cnpj); required por parte; signatários opt-in |
| **Importado vs gerado** | mesmo negócio pelos 2 pontos de entrada | isenção de required-paths no importado (D6) |

Para cada cenário: copiar a tabela das Fases A–H, preencher ✅/❌/🟡, anexar evidências e
fechar com o **punch list** dos ❌/🟡.

## 14. Critérios de aceite

- Fases A–H sem ❌. Fase I (se executada) sem ❌.
- Nenhuma duplicação de negócio no import (A4–A6, 12.1).
- Anexo de 6–8 MB com sucesso (C1–C2), sem 413.
- Aprovação bloqueada por dado faltante em contrato **gerado** (D4) e **liberada** em
  **importado** (D6).
- Edição direta (F) e via chat (G) refletidas no ChangeLog/Mudanças.
- Arquivar/desarquivar funcional em venda e locação (H).

---

# PARTE II — Automação Cypress

Esta parte transforma o roteiro acima em base para os testes **Cypress**. Cada fluxo tem:
pré-condições/fixtures, passos (com estratégia de seletor), asserções (UI + API + DB) e a
**matriz de modos de falha** (casos negativos). Foi calibrada contra a execução real de
2026-07-01 no staging (ver §19).

## 15. Fase J — Geração por formulário (form → template) e substituição nas `{{chaves}}`

Segundo ponto de entrada (`/forms/new`), **distinto do import**: aqui o contrato é
**renderizado por template Handlebars** a partir do `dataJson` do formulário
(`generateContractForDeal` → `enrichContractData` → `renderContratoHTML`). É o fluxo onde
existe substituição `form → {{chaves}}` (no import NÃO há — o contrato é o GDoc importado).

**Pré-condições:** org com **template default** por modalidade (`ContractTemplate isDefault`
para `a_vista` e `financiamento`) e **DocumentStyle default**. Sem isso a geração falha.

| # | Passo | Resultado esperado | ✅/❌/🟡 |
|---|---|---|---|
| J1 | `/forms/new` → título → "Criar Formulário" | Cria SalesForm+Deal; retorna **link `/f/<token>`** ("Formulário criado!") |  |
| J2 | Preencher as 7 etapas em `/f/<token>` (ou `PATCH /api/forms/<token>` com `dataJson`) | Auto-save 200; wizard bloqueia avanço se required/formato inválido (client) |  |
| J3 | Finalizar (`status:"completo"`) com dados válidos | `finalize 200`, `validationIssues: []`, `contractId` retornado; audit **`FORM_UPDATE`** (result SUCCESS) |  |
| J4 | Inspecionar `Contract.htmlContent` (gerado) | `templateId != null`; contém **nome do vendedor/comprador, CPF, matrícula, imobiliária, valor**; **NÃO contém `{{`** (nenhum placeholder cru) |  |
| J5 | Conferir helpers BR no texto | `moeda` → "R$ 500.000,00"; `extenso` → "(quinhentos mil reais)"; `cnpj` → "11.222.333/0001-81"; comissionado com `papel_texto` "Imobiliária principal" + "Participação: 100%" |  |
| J6 | Finalizar com **required-path vazio** (preset da org) | Gera contrato, mas cria `ContractComment severity=error`; **aprovação bloqueada** (`canForce:false`) |  |
| J7 | Aprovar contrato **gerado** válido vs **importado** | Gerado só aprova sem erros; importado é **isento** de required-paths |  |

**Asserção-chave da substituição** (a que responde "como foi a substituição nas chaves"):
`SELECT ("htmlContent" LIKE '%{{%') AS placeholder_cru` deve ser **false**, e cada valor do
`dataJson` deve estar presente no HTML (checar por ILIKE de nome/CPF/matrícula/valor). Um
`{{` remanescente = helper faltando ou chave não mapeada em `enrichContractData` (bug).

## 16. Cypress — estratégia, seletores e convenções

- **Ambiente:** rodar contra **staging** (Neon branch `staging` = `br-morning-morning-annso2kf`
  do projeto `wispy-tree-00688100`). NUNCA contra prod. `baseUrl: https://staging.imobpro.ia.br`.
- **Auth:** `cy.session` com login por credenciais (NextAuth Credentials). O staging usa o
  token ClickSign de prod (memória `feedback_clicksign_staging_token`) — a Fase I real
  gasta R$ 1,50/signer; marcar como `it.skip` por padrão ou gate por env `RUN_SIGN=1`.
- **Seletores:** o app **NÃO usa `data-testid` hoje** (verificado). Duas opções:
  1. **(Recomendado)** adicionar `data-testid` nos pontos-chave (dropzones, botões
     Arquivar/Aprovar/Importar, inputs do wizard, cards de anexo) — reduz fragilidade.
     Lista mínima sugerida no §18.
  2. Enquanto não houver, usar `cy.contains()`/role/label. Ex.: dropzone import =
     `input[type=file][accept*="pdf"]`; dropzone pasta = `input[type=file]` dentro do card
     "Clique ou arraste arquivos aqui"; botões por texto ("Arquivar", "Importar e abrir no
     editor", "Aprovar").
- **Upload de arquivo:** usar **`cy.get('input[type=file]').selectFile('cypress/fixtures/ccv.pdf', {force:true})`**
  — o Cypress preenche o input nativo de forma limpa (diferente do `/chrome`, cujo
  `file_upload` está quebrado e cujos eventos sintéticos quebram o React do `AddDocumentsCard`
  — ver memória `feedback_chrome_file_upload_broken`). Para o **anexo client-direct**, o
  `.selectFile()` no dropzone dispara `upload()` do `@vercel/blob/client`; interceptar
  `/attachments/blob-upload` (handshake) e `/attachments/finalize`.
- **Network intercepts (asserções de contrato de API):**
  ```js
  cy.intercept('POST', '/api/deals/import-contract').as('import');
  cy.intercept('POST', '**/attachments/blob-upload').as('handshake');
  cy.intercept('PUT', '**.blob.vercel-storage.com/**').as('blobPut');
  cy.intercept('POST', '**/attachments/finalize').as('finalize');
  cy.intercept('POST', '**/deals/*/archive').as('archive');
  cy.intercept('POST', '**/contracts/*/approve').as('approve');
  // ex.: cy.wait('@import').its('response.statusCode').should('be.oneOf',[201,200]);
  ```
- **Asserções de DB:** via `cy.task('db:query', sql)` (plugin `node-postgres` apontando pro
  branch Neon staging) OU pelos endpoints GET do app. Checagens canônicas em §12.
- **Fixtures:** `ccv-3mb.pdf` (~3.9 MB — força o caso do 413 antigo no anexo e do timeout no
  import), `ccv-financiamento.pdf`, `doc-6mb.pdf`, `datajson-avista.json`, `datajson-invalido.json`.
- **Idempotência/cleanup:** cada teste cria seus dados com título único (`QA-${Date.now()}`)
  e **deleta no `after`** via `DELETE /api/pipeline/deals/:id?deleteForm=true` (cascata +
  cleanup de blob). Verificar ausência de órfãos (§12.1).

## 17. Matriz de modos de falha (casos negativos — 1 `it` por linha)

> A base para "todas as possibilidades de dar problema". Cada linha vira um teste que
> **força** a condição e **asserta** a resposta esperada. Status esperado é o contrato de API.

**Import (`/api/deals/import-contract`)**
| Condição forçada | Esperado |
|---|---|
| Arquivo > 20 MB | 413 (client/route) |
| Mime não PDF/DOCX | 415 |
| Header binário inválido (`.txt` renomeado p/ `.pdf`) | 400 "header inválido" |
| PDF grande (lento) | conclui < 300s (maxDuration); **não** 504 |
| Re-import do **mesmo arquivo** (contentHash) | **200 deduped**, mesmo deal (não cria 2º) |
| Import anterior estourou (órfão sem Contract) + retry | reusa o órfão (não cria novo) |
| Gemini falha na extração | `dataJson: {}`, contrato criado mesmo assim (best-effort) |
| DOCX | export GDoc→PDF antes do Gemini; se export falha, fallback buffer cru |
| Pipeline de vendas não configurado | 400 |
| `BLOB_READ_WRITE_TOKEN` ausente | 500 (mensagem clara) |

**Anexo na pasta (`/attachments/blob-upload` + `/finalize`)**
| Condição forçada | Esperado |
|---|---|
| Arquivo > 10 MB | bloqueado no cliente (não sobe) |
| Arquivo 4.5–10 MB | **sucesso** client-direct (era 413 no caminho base64 antigo) |
| Handshake sem sessão | 401 |
| Handshake deal de outra org | 403 |
| Handshake pathname fora de `deal-attachments/<dealId>/` | 400 "fora do escopo" |
| Finalize URL de host externo (não-Blob) | 403 "URL não pertence a este negócio" |
| Finalize URL de outro deal | 403 |
| Finalize mesmo conteúdo (contentHash) | 200 **deduped** (não duplica; apaga blob redundante) |
| Finalize URL Blob válida e nova | 201 (cria DealAttachment `source=manual`) |
| Finalize download do blob falha | 502 |
| Finalize arquivo > 10 MB | 413 (defesa em profundidade) |

**Form → template (`/api/forms/[token]` finalize + `/approve`)**
| Condição forçada | Esperado |
|---|---|
| Required-path da org vazio (contrato **gerado**) | `ContractComment error` → aprovação bloqueada (`canForce:false`) |
| Contrato **importado** com dados esparsos | **isento** de required-paths (aprova) |
| CPF/CNPJ/formato inválido preenchido | `error` (collectPartyFormatIssues) |
| Casado(a) sem nome/CPF do cônjuge | `error` (meação) |
| Soma comissionados > 100% | `error` |
| Soma parcelas ≠ valor_total | `error` |
| Finalize com issues | `validationIssues[]` na resposta + audit `FORM_UPDATE` (FAILURE) |
| `{{...}}` cru no HTML gerado | linter de render marca finding (nunca deveria acontecer) |
| Helper Handlebars faltando após deploy | "Missing helper" (rodar `sync-templates` após deploy) |
| Sem template default p/ modalidade | geração falha |

**Obrigatoriedade config (`PATCH /api/org/form-settings`)**
| Condição | Esperado |
|---|---|
| `customRequiredPaths` com path órfão (`vendedores.0.cpff`) | **400** |
| `step: 7` (só há 0..6) | **400** |
| path válido conhecido | 200 |
| sem permissão `ORG_SETTINGS_EDIT` | 403 |

**Arquivamento (`/deals/:id/archive`)**
| Condição | Esperado |
|---|---|
| archive `{archived:true}` | 200, `archivedAt` set, audit `DEAL_ARCHIVED` |
| unarchive `{archived:false}` | 200, `archivedAt: null`, audit `DEAL_UNARCHIVED` |
| deal de outra org | 403 |
| kanban default | oculta arquivados; `?arquivados=1` mostra |

**Aprovação / imutabilidade**
| Condição | Esperado |
|---|---|
| `error` comments > 0 | `{requiresReview, canForce:false}` |
| aprovar contrato aprovado / editar / comentar | 403 (imutável); `/auto-analyze` → `{findings:[]}` |

**Deleção / assinatura**
| Condição | Esperado |
|---|---|
| deletar deal com envelope closed/running | **409** bloqueado |
| deletar deal | cascata + **blobs apagados** (sem órfão) |
| webhook ClickSign close | `signed.pdf` + DealAttachment `contrato_assinado` + (locação) laudo assinado; dedup url+contentHash |

## 18. `data-testid` sugeridos (para estabilizar o Cypress)

Adicionar (fora do escopo desta branch, recomendação): `deal-archive-btn`,
`deal-approve-btn`, `deal-delete-btn`, `import-dropzone-input`, `import-submit-btn`,
`folder-dropzone-input`, `attachment-card`, `wizard-step-{n}`, `wizard-next-btn`,
`wizard-finalize-btn`, `chat-input`, `chat-send-btn`, `required-field-marker`.

## 19. Registro da execução E2E — 2026-07-01 (staging, branch deployada)

Resultados reais desta rodada (evidência para calibrar os testes):

- **Deploy:** `dpl_2tpNWfK1` READY em `staging.imobpro.ia.br`; migrações `contentHash`/`archivedAt` aplicadas. ✅
- **A Import:** CCV 3.9 MB "Igor" importou sem timeout; re-import → **200 deduped**, 1 só deal; `contentHash` gravado. ✅
- **B OCR (doc→chaves):** extraiu 2 vendedores (+cônjuge Marcella aninhada), 1 comprador (+cônjuge Ozeni), imóvel (matrícula 144732), modalidade `financiamento`, 3 parcelas somando R$ 220.000, 3 comissionados somando 100%/R$ 13.200. **Lacunas:** 2 comissionados sem nome, 1 sem CNPJ, `banco_financiamento` null → revisar no form prefilled. 🟡 (extração correta na estrutura; nomes de comissionado é o ponto fraco do OCR)
- **C Anexo:** arquivo real 3.29 MB subiu client-direct (blob-upload 200 → PUT Blob → finalize 201), **sem 413**, `source=manual`+contentHash; handshake 200/400, finalize 403 anti-SSRF. ✅
- **D Obrigatoriedade:** path órfão + `step:7` → 400. ✅
- **F Edição direta:** editor Google Docs carrega e é editável (anyone-permission). ✅
- **G Chat:** agente responde (Plan/Sonnet 4.6/expert context), não edita em pergunta informativa. 🟡 **Observação fora de escopo:** disse "não há contrato carregado" para o **importado** — investigar leitura de texto do GDoc no staging.
- **H Arquivamento:** archive/unarchive 200 + audit. ✅
- **J Form→template:** finalize 200, `validationIssues:[]`; HTML gerado com todos os dados substituídos, **zero `{{` cru**; helpers `moeda`/`extenso`/`cnpj`/`papel_texto` corretos. ✅
- **Deleção:** cascata + cleanup de blob; ambiente limpo. ✅

**Nota de tooling:** o `/chrome` valida bem por **fetch nos endpoints** (com cookie de
sessão) + **DB no branch staging**; o upload de arquivo pela UI ficou limitado (file_upload
quebrado). No **Cypress** isso deixa de ser problema — `cy.get('input[type=file]').selectFile()`
resolve o upload nativamente.
