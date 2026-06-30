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
