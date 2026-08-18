# Bugs Conhecidos

## Formato

```
### [PRIORIDADE] Titulo do Bug
- **Status:** aberto | em progresso | resolvido
- **Encontrado em:** data
- **Descricao:** descricao do problema
- **Impacto:** qual funcionalidade e afetada
- **Solucao proposta:** como resolver
```

---

## Bugs Ativos

### [CRITICA] Migration nao-idempotente trava TODOS os deploys de producao (P3009) — reincidente
- **Status:** resolvido (PR #137 + `migrate resolve` em prod 2026-07-16); guarda-trilho pendente
- **Encontrado em:** 2026-07-16 (prod ficou ~7h sem conseguir deployar, 14:37 → 21:40 UTC)
- **Descricao:** `20260715140000_db_hygiene_defaults_indexes` (veio no #126) fazia `ALTER TABLE "Clause"` sem guardar a existencia da tabela. `Clause` foi unificada em `KnowledgeItem` (20260518 unify_clause), entao o statement estoura 42P01, a migration inteira aborta e a row fica em estado *failed* no `_prisma_migrations`. A partir dai o `prisma migrate deploy` recusa aplicar QUALQUER migration nova (P3009) e todo build de prod morre em ~19s, antes do `next build`.
- **Reincidencia:** o MESMO problema derrubou a staging horas antes e foi corrigido la (`79d3171b`), mas o fix ficou so na branch `staging` e nunca foi promovido pra master — entao prod pegou a versao quebrada. Ver tambem as migrations `unify_clause` e `clicksign_multitenant`, que ja tem `rolled_back_at` preenchido no banco de prod: e a terceira vez que essa classe de falha acontece.
- **Impacto:** CRITICO e silencioso — ninguem percebeu por 7h. Nenhum deploy de prod passa, incluindo hotfix de seguranca (bloqueou o #135, que fecha vazamento de PII).
- **Solucao aplicada:** (A) `to_regclass` guard nos ALTER de Clause/ClauseProposal (#137). (B) `prisma migrate resolve --rolled-back 20260715140000_db_hygiene_defaults_indexes` contra prod — a migration roda em transacao e abortou no 1o statement, entao nada dela tinha sido aplicado.
- **Guarda-trilho pendente:** (1) fix de migration que quebrou staging DEVE ir pra master antes/junto — o workflow `staging → master` nao cobre branches promovidas direto (`feat/*` → master, como o #126/#133); (2) alertar quando o deploy de prod falha (7h sem ninguem ver e o buraco real); (3) todo `ALTER TABLE` em migration deveria nascer com guard `to_regclass` — o repo tem historico de tabela removida por unificacao.

### [ALTA] "Falha no upload" ao anexar documentos na pasta do deal (limite 4.5MB da Vercel)
- **Status:** corrigido no codigo (pendente deploy) — branch worktree-melhorias-ocr-storage-obrigatoriedade
- **Encontrado em:** 2026-06-30
- **Descricao:** Anexar documento na aba Documentos do deal falhava com toast generico "<arquivo>: falha no upload" para arquivos medios/grandes. O `AddDocumentsCard` lia o arquivo como base64 (`readAsDataURL`) e enviava dentro de JSON pro `POST /api/deals/[dealId]/attachments-newton` (cap 10MB no cliente). Base64 infla ~33%, entao arquivos a partir de ~3.3MB geram corpo de request > 4.5MB — o limite FIXO de corpo de funcao serverless da Vercel (nao configuravel por next.config/maxDuration). A plataforma rejeita com 413 FUNCTION_PAYLOAD_TOO_LARGE ANTES do handler rodar; a resposta nao e JSON, entao `res.json()` falha e cai no toast generico. Mesma classe do arquivo de 3.9MB do incidente de negocios duplicados (grande demais tanto no import quanto no anexo). Logs da Vercel nao mostram esses POSTs (rejeicao pre-funcao).
- **Impacto:** ALTO — impossivel anexar PDFs/imagens escaneadas comuns (> ~3.3MB) na pasta do deal.
- **Solucao:** Upload client-direct pro Vercel Blob (`@vercel/blob/client` `upload()` + rota de handshake `/attachments/blob-upload` com auth/cross-org) — o navegador sobe direto pro Blob, contornando o limite de 4.5MB. Depois `/attachments/finalize` registra o DealAttachment (body so metadados; buffer baixado server-side pra contentHash/dedupe; valida que a URL pertence ao prefixo `deal-attachments/<dealId>/` do Blob). Logica de create+audit+OCR extraida pra `lib/deals/attachments.ts`, compartilhada com o `attachments-newton` (base64, mantido pro Newton Bearer).

### [ALTA] Negocios duplicados no import de contrato (timeout deixa orfaos + retry recria)
- **Status:** corrigido no codigo (pendente deploy + migracao) — branch worktree-melhorias-ocr-storage-obrigatoriedade
- **Encontrado em:** 2026-06-30 (3x "Cod 19503 Igor Imene (PG)" criados 17:39/17:42/17:43)
- **Descricao:** No cadastro rapido com upload (`/api/deals/import-contract`), um PDF de ~3.9MB gerou 3 deals identicos em ~4min. So o 3o tinha Contract; os 2 primeiros eram orfaos (Deal+SalesForm+anexo `contrato_original` sem Contract e sem audit `CONTRACT_IMPORT`). O import bem-sucedido levou 59s, colado no `maxDuration=60`. Causa-raiz: `importContractFromFile` (upload Drive + conversao + Gemini) estoura o timeout de 60s em PDFs grandes; a funcao serverless e morta no meio (o `catch` de limpeza nem roda), deixando orfaos. O operador re-sobe o mesmo arquivo achando que falhou, e cada retry cria um deal novo (sem dedup por conteudo).
- **Impacto:** ALTO — negocios duplicados na esteira; confusao + retrabalho; orfaos sem contrato poluindo o kanban.
- **Solucao:** (A) `maxDuration` 60->300 nas duas rotas de import (venda + locacao). (B) Dedup por `contentHash` (SHA-256 do arquivo): retry do mesmo arquivo devolve o deal ja importado (idempotente) ou REUSA o orfao de um import que estourou, em vez de criar outro negocio. Pendente: script de limpeza dos 2 orfaos legados em prod (deals `cmr0xphwf...` e `cmr0xm0w9...`).

### [ALTA] Certidoes duplicadas no download (ZIP) e na pasta do deal
- **Status:** em progresso (correcao de raiz implementada; pendente deploy + script de limpeza + QA)
- **Encontrado em:** 2026-06-03 (reincidente)
- **Descricao:** "Baixar todas (ZIP)" e a pasta do deal traziam 2-4 copias da mesma certidao (ex.: `tribunal/tjsp/obter-civel` x4, `receita-federal/pgfn` x3 em dias diferentes). `downloadAndAttach`/`runSerasaJob` criavam um `DealAttachment` NOVO a cada execucao (re-run, re-poll do passo `obter` em two-step, retry manual, re-enqueue do sweeper) com filename `..._${Date.now()}.pdf`. O dedupe do ZIP comparava `(pasta, filename)` -- como o filename muda a cada vez, NUNCA colapsava as duplicatas.
- **Impacto:** Documentos do deal poluidos + ZIP com arquivos repetidos; corretor confunde certidoes.
- **Solucao:** (A) `supersedePriorCertidaoAttachment` apaga a versao anterior do mesmo `(deal, provider, endpoint, parte, indice)` antes de criar a nova (`executor.ts`). (B) dedupe do ZIP por identidade ESTAVEL `endpoint|parte|indice` (`lib/certidoes/attachment-dedupe.ts` + `zip/route.ts`), colapsando ate as duplicatas legadas. (C) script `scripts/dedupe-certidao-attachments.ts` (dry-run/`--apply`) limpa as ja existentes em producao. FKs `CertidaoJob.attachmentId`/`Envelope.attachmentId` sao `onDelete: SetNull`.

### [MEDIA] Cônjuge preenchido no formulário nao aparece no contrato (contrato desatualizado)
- **Status:** em progresso (badge de drift implementado; geracao comprovadamente correta)
- **Encontrado em:** 2026-06-03 (reincidente)
- **Descricao:** Reportado como "dados do conjuge nao foram para o contrato". Investigacao com dados reais (15 conjuges casados desde 2026-05-15): a GERACAO sempre renderiza o conjuge na qualificacao E na assinatura. Causa real: o contrato e gerado UMA unica vez no finalize do formulario; quando o conjuge e completado depois (`form.updatedAt > contract.createdAt` -- no caso, 47s apos a geracao), nada propaga pro contrato. A usuaria contornava digitando o conjuge direto no Google Doc.
- **Impacto:** Contrato desatualizado em relacao ao formulario; retrabalho manual no Doc.
- **Solucao:** Badge "Formulario editado apos a geracao do contrato -- Regenerar" na aba Contratos do `DealDetail` quando ha drift. Regenerar cria uma NOVA versao com os dados atuais (nao-destrutivo, versoes anteriores preservadas). Sem auto-regeneracao -- ela descartaria edicoes manuais ja feitas no Doc.

### [ALTA] Card do deal de locação na esteira leva a 404 (rota /pipeline em vez de /locacao)
- **Status:** resolvido — deploy staging OK; verificado ao vivo 2026-06-06 (href do card = `/locacao/deals/${id}`). `KanbanDealCard.tsx`
- **Encontrado em:** 2026-06-06 (QA E2E staging)
- **Descricao:** Em `/locacao/esteira`, clicar em QUALQUER card de deal navega para `/pipeline/deals/[id]` (rota da esteira de VENDA), que retorna "Página não encontrada". A rota correta `/locacao/deals/[id]` funciona quando acessada direto. O href do `KanbanDealCard` da esteira de locação aponta para o caminho errado. Reproduzido nos 2 deals criados (residencial cmq2c7uuj... e comercial cmq2cyzj...).
- **Impacto:** ALTO — impossível abrir um negócio de locação pelo kanban (principal ponto de entrada). Bloqueia o fluxo inteiro pela UI.
- **Solucao proposta:** Corrigir o `href`/navegação do card no componente do kanban de locação (KanbanDealCard / esteira) para `/locacao/deals/${dealId}`.

### [MEDIA] Campo "Foro (comarca)" do formulário é ignorado no contrato gerado
- **Status:** resolvido — deploy + `sync-templates --apply` no staging OK; verificado ao vivo 2026-06-06 (contrato novo com foro="Campinas" rendeu "comarca de Campinas"). `enrich` expõe `config.foro_texto`; templates com fallback condicional. Teste-guarda em `render-locacao.test.ts`
- **Encontrado em:** 2026-06-06 (QA E2E staging)
- **Descricao:** No formulário comercial preenchi "Foro (comarca) = São Paulo" na etapa 6, mas a cláusula de foro do contrato renderizou o fallback boilerplate "as partes elegem o foro da comarca de localização do imóvel" — o valor digitado foi descartado. Ambos templates (residencial com foro vazio e comercial com foro="São Paulo") produziram o MESMO texto, confirmando que o campo `foro` não está mapeado no template. (O próprio agente IA passivo sinalizou "Campo 'foro' vazio no JSON de configuração".)
- **Impacto:** MÉDIO — input do usuário silenciosamente perdido; juridicamente o resultado coincide quando o imóvel está na mesma comarca, mas diverge se o foro eleito for diferente.
- **Solucao proposta:** Mapear `config.foro` (ou `foro`) no `enrichLocacaoData`/templates de locação para a cláusula de foro, com fallback para a comarca do imóvel só quando vazio.

### [MEDIA] Tipo do imóvel comercial renderiza o slug do enum no contrato ("comercial_sala")
- **Status:** resolvido — deploy + `sync-templates --apply` no staging OK; verificado ao vivo 2026-06-06 (contrato novo com kind="loja" rendeu "o imóvel de tipo loja"). `enrich` mapeia `imovel.kind`→`imovel.tipo_texto`; templates usam o rótulo. Teste-guarda em `render-locacao.test.ts`
- **Encontrado em:** 2026-06-06 (QA E2E staging)
- **Descricao:** No contrato comercial, a Cláusula 1ª renderiza "o imóvel de tipo **comercial_sala**" — o valor cru do enum em vez do rótulo legível "Sala comercial". Falta o mapeamento enum→label do `imovel.kind` no template/enrich de locação comercial.
- **Impacto:** MÉDIO — qualidade/profissionalismo do contrato comercial (slug técnico visível ao cliente).
- **Solucao proposta:** Mapear `imovel.kind` para rótulo PT-BR (apartamento→"Apartamento", comercial_sala→"Sala comercial", etc.) no enrich de locação antes do render.

### [MEDIA] Análise passiva da IA: falsos-positivos severity=error + vazamento de nomes internos config.*
- **Status:** resolvido — deploy staging OK; verificado ao vivo 2026-06-06 (contrato novo: 0 vazamento `config.*`, sem error falso-positivo de prazo/multa; o único error restante é legítimo — foro≠comarca do imóvel). Regras 14.1/14.2 em `prompts.ts`
- **Encontrado em:** 2026-06-06 (QA E2E staging)
- **Descricao:** Os comentários `authorType=ai` são bem ancorados e os WARNINGS são úteis (foro não especificado; apólice de seguro-fiança ausente). Porém os comentários de severity=**error** foram falsos-positivos por nitpick de unidade: (res) "30 meses de 01/07/2026 a 31/12/2028 totaliza 30 meses e 1 dia" — está correto, é exatamente 30 meses; (com) "multa 3 aluguéis vs config.multa_rescisoria_meses=3 meses" — coincidem, não há inconsistência. Além disso, os textos expõem nomes internos de campos (`config.foro`, `config.multa_rescisoria_meses`, `config.garantia.provider`) ao usuário final.
- **Impacto:** MÉDIO — "errors" falsos inflam a contagem e podem bloquear/assustar na aprovação (approve conta errors não-resolvidos); jargão interno reduz a clareza.
- **Solucao proposta:** Calibrar o prompt da análise passiva para não classificar coincidências numéricas corretas como error e para não citar nomes de campos `config.*` no texto voltado ao usuário.

### [MEDIA] Plano (chat): add_comment executa mesmo com insert_clause falho → comentário inconsistente
- **Status:** resolvido — deploy staging OK; verificado ao vivo 2026-06-06. `PlanStep.dependsOn` + status "skipped"; propose_plan aceita dependsOn (índices), handler converte→IDs; execute-plan PULA step com dependência não-executada (helper `unmetDependencies`, lib/ai/plan-deps.ts, 6 testes); prompt 11.0.1 orienta o planner; PlanCard renderiza "skipped". E2E: edit falhou → add_comment dependente foi PULADO (comentário falso não gravado).
- **Encontrado em:** 2026-06-06 (QA E2E staging)
- **Descricao:** No modo Plano, aprovei 3 ações. `insert_clause` falhou (auto-resolve não achou cláusula "vistoria de entrada" na base) e `propose_suggestion` falhou (trecho-alvo não encontrado no HTML), mas o `add_comment` rodou e gravou "RECOMENDAÇÃO DE PADRONIZAÇÃO: A cláusula de Vistoria de Entrada **inserida neste contrato**..." — afirmando uma inserção que NÃO ocorreu (e que, ademais, já existe na Cláusula 8ª do template). Os passos do plano executam de forma independente, sem checar o sucesso dos anteriores.
- **Impacto:** MÉDIO — comentários/recomendações confabulados (afirmam alterações inexistentes); erode a confiança no agente.
- **Solucao proposta:** No `execute-plan`, condicionar/contextualizar passos dependentes ao resultado dos anteriores (ex.: não afirmar "inserida" se o insert falhou); e o agente verificar a base antes (regra 11.0 já prevê query_knowledge_base para IDs dependentes).

### [BAIXA] insert_clause inoperante para locação (base sem cláusulas de lease) + propose_suggestion falha por anchor mismatch
- **Status:** resolvido — deploy + seed no staging OK; verificado ao vivo 2026-06-06 (insert_clause "vistoria de entrada" → OK + verified). Seed `scripts/seed-locacao-clauses.ts` (10 cláusulas Lei 8.245/91) na base; fallback ILIKE agora tokenizado (casa por palavra+tags, recall p/ query verbosa). Fluxo formal propose_* permanece disponível. (anchor-mismatch do propose_suggestion é limitação separada do LLM, mitigada pelo skip de dependência do #5.)
- **Encontrado em:** 2026-06-06 (QA E2E staging)
- **Descricao:** `insert_clause` depende de uma cláusula existente na base de conhecimento; para locação o auto-resolve (Voyage/ILIKE) não encontrou nada para "vistoria de entrada" → falha. `propose_suggestion` falhou porque o `before`/target gerado pelo LLM não bateu exatamente com o HTML do contrato. Consequência: pedir ao agente para "adicionar cláusula nova" via Plano não aplica nada. O fluxo formal de retroalimentação (`propose_new_clause`/`propose_template_change` → ClauseProposal/TemplateSuggestion) NÃO foi acionado — o agente preferiu add_comment (ClauseProposal=0, TemplateSuggestion=0).
- **Impacto:** BAIXO/MÉDIO — feature de inserção de cláusula e o ciclo de padronização do template ficam efetivamente indisponíveis para contratos de locação.
- **Solucao proposta:** Popular a base de cláusulas (KnowledgeItem category="clause") com cláusulas de locação; permitir insert_clause cair em inserção de texto custom quando não há match; reforçar o anchor-matching tolerante no propose_suggestion.

### [MEDIA] Campos config vazios no template legado v1
- **Status:** aberto (nao afeta templates v2)
- **Encontrado em:** 2026-04-10
- **Descricao:** Template legado v1 (contrato_compra_venda.hbs) mostra campos vazios na secao 8 (Irretratabilidade): "Multa penal de %" sem o valor. Os templates v2 (ccv_a_vista_v2, ccv_financiamento_v2) usam campos config corretamente.
- **Impacto:** Apenas contratos gerados com template v1 (deprecated). Novos contratos usam v2 sem este problema.
- **Solucao:** Garantir que `config` tenha valores default no formulario. Template v1 nao sera corrigido pois esta deprecated.

### [BAIXA] Sem auto-save para edicoes diretas no TipTap
- **Status:** aberto
- **Encontrado em:** 2026-04-11
- **Descricao:** Edicoes diretas no TipTap nao sao salvas automaticamente. O hook `use-auto-save` existe mas so e usado nos formularios. Contratos requerem clique manual em "Salvar Versao".
- **Impacto:** Usuario pode perder edicoes se fechar a pagina sem salvar
- **Solucao:** Implementar useAutoSave no ContractEditorPage com endpoint /api/contracts/{id}/auto-save

## Bugs Resolvidos

### [ALTA] Certidoes: E-Proc 600 "erro inesperado" virava "Negativa - nada consta" (falso-positivo) + "Retentar erros" inflado por endpoints sem PDF
- **Status:** resolvido
- **Encontrado em:** 2026-06-10 (auditoria front vs backend no deal cmpypeb95)
- **Resolvido em:** 2026-06-10 (PR #67, prod; QA real: "Retentar erros" 9->5 batendo com "Precisa acao", E-Proc re-disparado voltou 612 "Nenhum Resultado" — negativa com evidencia; rows legadas success-600 substituidas por replaced)
- **Descricao:** (1) `classifyOutcome` fechava endpoints informativos (`emitsPdf:false`) como "success negativa" apos 1 retry para QUALQUER categoria genuine_no_data — inclusive code 600 "Um erro inesperado ocorreu" (CODE_MAP), que nao traz evidencia nenhuma de ausencia. A UI exibia "Negativa - nada consta" (verde) para consulta que nunca rodou. (2) `isRetryableError` contava "success sem attachment" como retentavel sem checar `emitsPdf` — eproc-lista e trf/cert-unificada NUNCA anexam por design, entao "Retentar erros (9)" nao batia com "Precisa acao (5)" e re-disparava consultas saudaveis.
- **Impacto:** Risco juridico de afirmar negativa inexistente; contagem do retry errada re-disparando consultas OK (custo desnecessario).
- **Solucao:** `genuine_no_data` informativo agora exige evidencia textual de ausencia ("nada consta"/"nenhum resultado"/"nao encontrado") para fechar como negativa; sem evidencia -> retry portal_unavailable ate esgotar -> failed_permanent + CTA portal. `isRetryableError` ganha gate `emitsPdf === false` no caminho success-sem-anexo (LifecycleJob.endpoint opcional).

### [ALTA] Certidoes: diligenciado (tier opcional) ficava fora do lote + obter e-SAJ recusava pedido_data DD/MM/YYYY
- **Status:** resolvido
- **Encontrado em:** 2026-06-09 (deal cmpypeb950007sdha0zb7tveq, prod)
- **Resolvido em:** 2026-06-10 (PR #66, prod; QA real: 4 TJSP destravaram no ciclo seguinte do cron e baixaram 4 PDFs distintos por pessoa/modelo; PR #67 complementa as mensagens do front — 608 multi-campo, timeout real, variante terminal)
- **Descricao:** (1) PJs avulsas adicionadas como DiligentedPerson nunca viravam CertidaoJob: `tierForJob` dava tier "opcional" a diligenciado -> nasciam desmarcadas em secao colapsada do ExtractCertidoesDialog, e "So as que faltaram" varre apenas tier "padrao" SUBSTITUINDO a selecao inteira (desmarca ate selecao manual previa). (2) 4 pedidos TJSP presos em `awaiting_portal`: o poll do `tribunal/tjsp/obter-certidao` enviava `pedido_data` em DD/MM/YYYY (formato persistido no DB via formatDateBR) e a Infosimples valida como ISO — 607 com `errors[]: "pedido_data possui um valor invalido"` em todo ciclo ate o prazo de 7d. O `code_message` do 607 lista TODOS os params ("cnpj, cpf, numero_pedido, pedido_data") — a causa especifica so aparece em `errors[]` (mesma licao do 604: classificar pelo texto combinado).
- **Impacto:** Diligenciados (socios PJ, fiadores, terceiros) silenciosamente fora dos lotes; certidoes TJSP two-step nunca baixavam (morriam por "prazo do portal esgotado" apos 7d).
- **Solucao:** `tierForJob`: diligenciado -> "padrao" (pre-marcado + incluido no "So as que faltaram"); `normalizePedidoData` DD/MM/YYYY -> ISO na hora do obter (cobre jobs antigos do DB); trim no numero_pedido (TRF3 devolve com espaco a esquerda). Reproduzido com chamada real: 607 -> 200 com ISO.

### [ALTA] Envio de documento avulso travado: CNPJ rejeitado pela ClickSign + draft orfao bloqueia reenvio
- **Status:** resolvido
- **Encontrado em:** 2026-06-02
- **Resolvido em:** 2026-06-03 (PR #54, prod; QA real no deal Walter Santos)
- **Descricao:** Aba Assinaturas nao enviava o PDF (o arquivo nao era o problema). DOIS bugs: (A) a parte PJ era enviada com o CNPJ da empresa como `documentation` do signatario, e a ClickSign v3 so aceita CPF (signatario e pessoa fisica) -> 422 "documentation nao esta em um formato valido" (confirmado em teste controlado: 1 signer com CNPJ falhou, R$0). (B) um Envelope local `draft` ORFAO (clicksignId=null, criado mas nunca enviado -- provavel timeout no fluxo) bloqueava QUALQUER reenvio do mesmo PDF com 500 "Ja existe um envelope draft para esse documento".
- **Impacto:** Impossivel enviar para assinatura -- erro travado, sem caminho de saida.
- **Solucao:** (A) Quem assina pela empresa e o REPRESENTANTE: `dealDataToSigners` e `SendEnvelopeDialog` usam o representante (nome/email/CPF dele) como signatario das partes PJ, nunca a empresa/CNPJ; `addSigner` (envelopes.ts) omite qualquer CNPJ de 14 digitos defensivamente. (B) `sendEnvelopeForAttachment` limpa drafts orfaos (status draft + clicksignId null) e so bloqueia envelopes genuinamente ativos (running ou draft com clicksignId). QA: reenvio real concluido (5 signatarios notificados, Mateus vendedor com CPF dele).

### [ALTA] Certidoes: antecedentes PF nao emitia + 609 e Receita 611 misclassificados + TJSP 604 recorrente
- **Status:** resolvido
- **Encontrado em:** 2026-06-02
- **Resolvido em:** 2026-06-03 (PR #52, prod; QA real no deal cmpveb21g)
- **Descricao:** Analise dos resultados do dia revelou: (1) Antecedentes PF morria com status legado `failed` "numero_pedido ausente" -- o `emit` estava marcado twoStep mas o 200 ja traz o resultado/PDF. (2) Code 609 "tentativas de consultar o site excedidas" (portal indisponivel, transitorio) caia em `data_invalid` ("corrija os dados") sem retry. (3) Receita/PGFN 611 "insuficientes para emitir pela Internet" caia em data_invalid, sendo na verdade NAO-EMISSAO da RFB (nao e erro nosso -- o MESMO payload emite p/ outros CPFs; provado por JSON cru + recibo). (4) TJSP 604 "mesmo email multiplas vezes": cada PF gera 2 pedidos (modelo 4+1) com o MESMO `email_envio`.
- **Impacto:** Certidoes travadas/mal-classificadas; um deal ficou com 0 sucessos (100% 604).
- **Solucao:** antecedentes deixa de ser twoStep (`endpoints.ts`); 609 -> portal_unavailable (retry) via heuristica de mensagem ANTES do CODE_MAP (`error-codes.ts`); 611 -> failed_permanent+portal RFB (`outcome-classifier.ts`); TJSP email distinto por pedido via plus-alias (`local+token@dominio`, token com kind+indice) (`planner.ts`). Mapa duravel: `docs/certidoes-known-issues.md`. QA real: 0x 604, antecedentes success, 609 -> retry.

### [MEDIA] Parte PJ sumia silenciosamente dos signatarios (`??` vs `||`) + email exigido so do 1o titular
- **Status:** resolvido
- **Encontrado em:** 2026-06-02
- **Resolvido em:** 2026-06-03 (PR #53, prod)
- **Descricao:** `partyName` usava `??`: a PJ guarda `nome:""` (string vazia) + `razao_social`, e o `??` nao cai pro razao_social com string vazia -> nome vazio -> a PJ era DESCARTADA dos signers sem nem entrar em `missing` (sumia do envelope sem aviso). Alem disso, o email obrigatorio do formulario so valia para a 1a parte (paths do preset eram `.0.`).
- **Impacto:** Co-parte PJ nao assinava e ninguem percebia; 2a parte sem email nao era cobrada no form.
- **Solucao:** `??` -> `||` em `mapping.ts` e `SendEnvelopeDialog.tsx`; `effectiveRequiredPaths` (`party-required.ts`) expande os campos de parte do preset para TODOS os indices existentes (com remap PJ por indice).

### [BAIXA] Helper `extenso` nao encontrado
- **Status:** resolvido
- **Encontrado em:** 2026-04-10
- **Resolvido em:** 2026-04-11
- **Descricao:** Template usava `{{extenso pagamento.valor_total}}` mas parecia nao funcionar
- **Solucao:** O helper `extenso` ja existia em `handlebars.ts` (funcao `valorPorExtenso`). O problema era no template v1 que nao usava o helper corretamente. Templates v2 usam `{{extenso valor}}` e renderizam corretamente (ex: "seiscentos mil reais"). Verificado com 21 testes automatizados.

### [ALTA] Contratos aprovados podiam ser versionados via API
- **Status:** resolvido
- **Encontrado em:** 2026-04-11
- **Resolvido em:** 2026-04-11
- **Descricao:** O endpoint POST /api/contracts/{id}/version nao verificava se o contrato estava aprovado. Era possivel criar versoes de contratos aprovados via API, ignorando o lock da UI.
- **Solucao:** Adicionado check de status no version route: retorna 403 para contratos aprovados.

### [MEDIA] insert_clause inseria clausulas sempre no final do contrato
- **Status:** resolvido
- **Encontrado em:** 2026-04-11
- **Resolvido em:** 2026-04-11
- **Descricao:** O tool handler `insert_clause` usava `lastIndexOf("</div>")` para insercao, colocando todas as clausulas no final do contrato sem posicionamento semantico.
- **Solucao:** Implementado busca por `<!-- CLAUSE_SLOT:Gx -->` baseado no `groupCode` da clausula. Fallback para `afterSection` (parametro do agente) e ultimo `</div>`.

### [INFO] Puppeteer incompativel com Vercel Serverless
- **Status:** resolvido
- **Encontrado em:** 2026-04-10
- **Resolvido em:** 2026-04-11
- **Descricao:** O pacote `puppeteer` completo nao funciona no Vercel serverless devido ao tamanho do Chromium bundled
- **Impacto:** Export PDF nao funciona em producao no Vercel
- **Solucao:** Migrado para `puppeteer-core` + `@sparticuz/chromium`. Funciona em Vercel serverless.

### [MEDIA] TextractClient crashava build quando AWS_REGION vazio
- **Status:** resolvido
- **Encontrado em:** 2026-04-11
- **Resolvido em:** 2026-04-11
- **Descricao:** `TextractClient` era instanciado no escopo do modulo com `process.env.AWS_REGION`. Quando vazio, causava "Region is missing" durante `next build` na coleta de dados da pagina `/api/documents/[id]/extract`.
- **Impacto:** Build falhava sem credenciais AWS configuradas
- **Solucao:** Lazy-initialization com `getTextractClient()` que so cria o client quando chamado

### [ALTA] TipTap SSR Hydration Error
- **Status:** resolvido
- **Encontrado em:** 2026-04-10
- **Descricao:** ContractEditor crashava com erro "SSR has been detected, please set immediatelyRender explicitly to false"
- **Impacto:** Pagina de edicao de contrato retornava 500
- **Solucao:** Adicionado `immediatelyRender: false` no `useEditor` config

### [ALTA] Registro nao copia template e clausulas
- **Status:** resolvido
- **Encontrado em:** 2026-04-10
- **Descricao:** Ao registrar novo usuario, a org era criada sem ContractTemplate e sem Clausulas, causando "No default template found" ao gerar contrato
- **Impacto:** Nenhum usuario novo conseguia gerar contratos
- **Solucao:** Endpoint de registro agora copia template default e clausulas seed para a nova org

### [INFO] Auth sem sessoes/JWT
- **Status:** resolvido (no plano)
- **Encontrado em:** 2026-04-10
- **Descricao:** Sistema de auth atual usa bcryptjs mas nao persiste sessoes. Login nao funciona de verdade.
- **Impacto:** Nenhuma rota e realmente protegida
- **Solucao:** Migrar para NextAuth v5 com Prisma Adapter e JWT sessions
