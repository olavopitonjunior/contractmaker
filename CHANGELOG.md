# Changelog

Todas as mudancas notaveis neste projeto serao documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).

## [Unreleased] - 2026-08-18 - Ressalvas de QA pós-promo2 (resumo, FAB, /propostas)

### Corrigido

- **Unique parcial do resumo por negócio** (`DealAttachment_dealId_form_summary_key`, migration `20260818213000` com saneamento de duplicatas ANTES do índice): fecha a corrida create-vs-create de "Baixar PDF" + "Enviar" simultâneos; `persistFormSummaryPdf` trata `P2002` degradando pra update da linha vencedora (e deleta o blob substituído). Índice é parcial (`WHERE source='form_summary'`) — anexos manuais seguem ilimitados; documentado no schema, único writer é o próprio persist.
- **Diálogo do resumo**: "Baixar PDF" mostra "Gerando…" durante a geração (evita clique repetido no ~5-8s de Puppeteer) e "Enviar" fica desabilitado até selecionar destinatário.
- **FAB do assistente IA** não cobre mais o "Salvar identidade" em `/settings/perfil` em viewport estreita (respiro no fim do container).
- **`/propostas` redireciona** para `/pipeline/propostas` (antes 404).

## [Unreleased] - 2026-08-18 - Visibilidade de seções por link de parte, configurável

### Adicionado

- **Card "Seções por link de parte"** em `/settings/formulario` (`ParticipantVisibilityCard`): matriz papel × etapa por esteira (venda/locação) gravada em `OrgFormSettings.participantVisibilityJson` (migration aditiva `20260818190000`), merge por branch e sanitização ANTES de gravar (`parseParticipantVisibilityJson`). Aplica ao vivo em links já emitidos — visibilidade não é obrigatoriedade.
- **Novo módulo `lib/forms/participant-visibility.ts`** — fonte de verdade: catálogo `STEP_PATHS` (etapas habilitáveis × data-paths), `DEFAULT_ROLE_STEPS` e `resolveRoleVisibility`. **Defaults novos (pedido 2026-08-18):** comprador ganha a etapa Pagamento; locador ganha Aluguel e Reajuste; locatário ganha Garantia (e, coerentemente, a atribuição de docs do fiador); vendedor e fiador mantêm o histórico. `resolveParticipantScope` passa a carregar a config da org; `ROLE_PATHS`/`ROLE_STEP_INDEXES` viraram derivados dos defaults (sem segunda cópia); `voice-extract` idem.
- **Guard-rail por construção:** a config só escolhe etapas do catálogo — etapa 6 (Comissão) e as chaves `comissao`/`fiscal`/`testemunhas`/`assinatura`/`config` são inalcançáveis por subtoken, mesmo com Json malicioso no banco (testes em `participant-visibility.test.ts`).

### Alterado

- `requiredPathsForRoleScope`/auto-save/finalize acompanham automaticamente (já eram dirigidos por `stepIndexes`/`topKeys` do scope).

## [Unreleased] - 2026-08-18 - Form de locação: administração, despesas, cláusula rescisória e comissão

### Adicionado

- **Administração e despesas na etapa 4 do form público de locação** (`aluguel.*` em `validation-locacao.ts`, UI no `AluguelStep`): "A locação terá administração pela imobiliária?" (Sim/Não); com "Sim", como os encargos transitam (`encargos_repasse`: paga-e-retém no repasse ou repasse integral no boleto) e a taxa de administração (%); com condomínio, se as contas de consumo são individualizadas ou quais somam no boleto do condomínio (`contas_no_condominio`: água/luz/gás). O finalize exige `encargos_repasse` quando adm=sim e a lista quando não individualizadas. `enrichLocacaoData` materializa `config.*` e — decisão nova — **"Não" explícito impede a nomeação da administradora** no contrato de locação (cláusulas 4.1/9.1.2 caem no fallback direto ao locador); o instrumento de administração re-injeta por conta própria. Templates v3 (residencial+comercial): 9.1.2 ramificada por `encargos_repasse`, 9.3 por individualização (concessionárias ENEL/SABESP/COMGÁS hardcoded viraram texto genérico). Espelho no negócio: `create-lease-contract` já lia `aluguel.taxa_admin_percent` como fallback.
- **Cláusula rescisória opcional** (`config.clausula_rescisoria`, default true; card na etapa Garantia): "Não" omite a cláusula 7.2 (multa por rescisão antecipada) nos dois templates v3 — a 7.1 (multa por infração) permanece, pois 5.4/6.7 a referenciam. Forms antigos inalterados (default no enrich).
- **Etapa "Comissão" no form público de locação** (nova etapa 6, token principal apenas — subtokens não a veem): paridade com venda usando `comissao.taxa_locacao_percent` + `comissao.angariadores[]` já existentes. Lookup "Selecionar cadastrado" reusa `GET/POST /api/forms/[token]/commissioners` (a rota resolve `SalesForm.token` e serve as duas esteiras — sem rota gêmea), com anti-duplicação (`findCommissionerMatch`) e autopreenchimento; auto-cadastro no finalize já cobria `angariadores`.
- **`CadastroRecebimento` compartilhado** (`components/forms/steps/CadastroRecebimento.tsx`, extraído do `ComissaoConfigStep` de venda): título de seção visível e botão outline "Preencher dados bancários" (era ghost text-xs escondido); em cadastro já vinculado, membro ganha **"Pedir dados ao corretor"** — reusa o magic link de completion (`/api/financeiro/split-recipients/[id]/request-completion`), o corretor preenche PIX/banco num link próprio por e-mail. Regra mantida: anônimo nunca envia dado bancário.
- **Propagação:** semântica dos campos novos no prompt do Analista de locação (`prompts-locacao.ts` regra 9), description de `fill_form` no MCP do Newton, 4 FAQs novas de locação no seed de suporte (`seed-faq.ts` — rodar `seed-support-kb.ts --apply` ou o botão em /admin/support-ai), `docs/locacao/spec.md` §4.1. **Deploy exige `sync-templates.ts --apply`** (v3 mudou) e recriação do container MCP na VPS.

## [Unreleased] - 2026-08-18 - Laudo de vistoria externo + seed de pesquisa padrão

### Adicionado

- **Template padrão de pesquisa de satisfação** (`src/lib/surveys/seed.ts` + `scripts/seed-survey-templates.ts`): NPS + CSAT + comentário livre, neutro entre vendas e locação. Script no padrão dry-run/`--apply`/`--orgId=` (dry-run reporta "would create", distinto do apply), alvo = orgs sem nenhum template ativo e com feature de pesquisas ligada; idempotente por `(orgId, name)`; `createdBy` cai no owner da org. Org nova passa a nascer com o template (`api/admin/orgs`, best-effort como os seeds vizinhos).
- **Upload de laudo de vistoria pronto**: vistoria feita fora do sistema entra por PDF (≤20MB) e vai direto a `status="laudo_gerado"` com `Inspection.laudoOrigem="externo"` (migration aditiva `20260818120000`) — elegível pro envelope conjunto com o contrato de locação (`collectInspectionExtraDocuments`) e pro envio avulso; a assinatura conjunta já existia, faltava a porta de entrada. Fluxo em duas rotas no padrão dos anexos: handshake `laudo/blob-upload` (upload client-direct pro Vercel Blob, contorna os ~4.5MB de corpo de função) + registro `laudo/upload` (valida propriedade da URL, magic bytes via `sniffFileType`, update condicional ao status editável — corrida com envio pra assinatura vira 409 — e zera `qrToken` pra o QR do laudo substituído não seguir validando). Botão "Anexar laudo pronto" no `LaudoEditor` (vira "Substituir…" quando já há PDF; "Regerar" sobre laudo externo pede confirmação). Regeração interna volta `laudoOrigem="gerado"`. Audit `INSPECTION_LAUDO_UPLOADED`. `docs/locacao/spec.md` §7 atualizado (falava em `Envelope source="attachment"`; o real é `EnvelopeDocument kind="attachment"`).

## [Unreleased] - 2026-07-30 - Hardening da trava de grupo do Newton

Follow-ups do review do #197, ambos em `apps/mcp-server/src/tools.ts`.

### Alterado

- **`isGroupJid` cobre mais formatos:** além de `<digitos>-group` (convenção da bridge), agora reconhece o sufixo nativo `@g.us` (case-insensitive) e o JID legado com hífen interno (`<criador>-<timestamp>-group`), que escapavam do regex só-dígitos.
- **`normalizeWhatsappTo` é fail-closed:** JID de grupo lança `assertNotGroupTarget` em vez de passar intacto. Os handlers já barram antes, então o ramo é redundante hoje — de propósito, pra que um caller futuro sem o assert falhe em vez de mandar mensagem pro grupo.

## [Unreleased] - 2026-07-25 - Newton calado nos grupos: runtime + tools

Segunda metade da mudança abaixo. A primeira tirou a iniciativa automática do lado
Contractmaker; esta fecha o comportamento do agente em si.

### Adicionado

- **Trava determinística contra envio proativo pra grupo** (`assertNotGroupTarget` em `apps/mcp-server/src/tools.ts`): `whatsapp_send` e `schedule_proactive_message` agora rejeitam JID de grupo (`<id>-group`) com erro. O `normalizeWhatsappTo` deixava passar intacto, então a proibição era 100% prompt — e o modelo ativo é nano-tier. Responder num grupo mencionado continua funcionando: essa resposta volta pelo webhook da bridge, não por essas tools.

### Alterado

- **Persona do agente (fora do repo, via Mission Control → Persona):** `SOUL.md` ganhou a subseção "Escopo de ação em grupo" e perdeu o bullet que autorizava responder sem `@`; `AGENTS.md` ganhou nota de precedência em "Group Chats" e um bloco absoluto em "Red Lines". Registro do que foi gravado, com os backups pra rollback, em `docs/newton-persona-snapshot-2026-07-25.md`.
- **Descrições das tools MCP** (`apps/mcp-server/src/tools.ts`): `whatsapp_send`, `schedule_proactive_message`, `list_newton_requests`, `update_newton_request` e o comentário do bloco Newton Requests mandavam o agente cobrar informação, agendar lembretes e mandar DM ao fechar. Agora dizem o contrário — o inbox é registro interno, envio proativo é só DM e nunca re-cobrança.

### Corrigido na VPS (fora do repo)

- **O relatório em grupo existia, e não era cron do openclaw.** `🗂️ Resumo de propostas — Negócios NC` saía 2×/dia (08:30 e 17:30) do `proposal-tracker.js`, scheduler próprio do sidecar, configurado por env no `.env` de `/docker/openclaw-mvzp/`. Desligado esvaziando `NC_PROP_CHASE_TIMES`; `NC_PROP_GROUP_ID` mantido de propósito, preservando a consulta por `@` com as tools `prop_*`. Junto, `handlePropTool` passou a chamar `ingestGroupDelta` — sem isso a consulta responderia dado congelado, já que o único chamador era o `runChasePass` que não roda mais. Backups `.env.bak-prop-chase-off-*` e `proposal-tracker.js.bak-preingest-*`.
- Crons do openclaw auditados (aba Crons do MC): `morning-briefing` e `stale-deals`, ambos `telegram→` DM do Olavo, sem execução há ~1 mês. Max não tem cron. A aba Crons **não enxerga** os schedulers do sidecar — foi por isso que a primeira auditoria concluiu, erradamente, que não havia relatório em grupo.
- Smoke no sandbox do MC: com a política só no `SOUL.md` o modelo ainda respondia sem `@` e se oferecia pra cobrar diariamente; com o bloco em "Red Lines", parou. O caminho positivo (`create_form`) fica inconclusivo — o sandbox interrompe na 1ª tool call.

### Deploy

- **MCP server na VPS: feito.** `dist/` copiado pra `/docker/openclaw-mvzp/contractmaker-mcp-server/dist/` (backup `dist.bak-groupguard-*`) e container `sidecar` recriado. O boot confirma `connected to https://imobpro.ia.br (81 tools)` — eram 80 antes, ou seja, o MCP da VPS estava atrás do repo e o deploy trouxe também o que já estava em `master` sem ter subido.
- **`doc-collector` desligado**: `WATCH_DOC_COLLECTOR: "1"` → `"0"` em `/docker/openclaw-mvzp/docker-compose.yml` (backup `.bak-doccollector-off-*`). Era o watcher que observava grupos com `group_config.watch_documents=1` e, ao ver documento novo, perguntava na DM da aprovadora. Não postava no grupo, mas era captura passiva — fora do escopo desejado. A linha `[doc-collector] ativo` sumiu do boot.

### Pendente

- **Inbound de WhatsApp está 403** — `turn sem orgId e NEWTON_REQUIRE_ORG_ID=1`. O bridge (`whatsapp-newton-bridge`) não manda `orgId` no forward pro sidecar, enquanto o Contractmaker manda. Correção na branch `fix/forward-orgid` daquele repo; depende de setar `NEWTON_ORG_ID` no projeto Vercel antes do deploy. Enquanto isso, o `@` no grupo não responde nada.
- Validação temporal: 24h com pendência aberta no inbox e nenhuma mensagem no grupo.

## [Unreleased] - 2026-07-25 - Newton para de capturar informação nos grupos

### Removido

- **Cron `/api/cron/newton-requests/sweep`** (horário) — motor de re-cobrança que fazia o Newton voltar ao grupo/contato atrás de informação pendente. Saiu de `vercel.json`, do `KNOWN_CRON_PATHS` de `/api/admin/staging-crons/[path]` e do catálogo da UI de staging-crons. Rota e testes deletados.
- **Disparo imediato em `POST /api/deals/:dealId/newton-requests`** — criar pedido agora só grava a `NewtonRequest`; nenhum turn vai ao sidecar.
- `TriggerArgs.kind: "remind"` e o branch correspondente em `buildText` (só o sweep usava).

### Alterado

- O inbox de pedidos virou **registro interno**: aba do negócio renomeada de "Pedidos ao Newton" pra **"Pendências"**, copy do diálogo e toasts ajustados pra não prometer cobrança automática.
- `triggerNewtonForRequest` fica restrito a dois usos: envio one-shot de pesquisa de satisfação (`lib/surveys/channels.ts`) e `kind:"cancel"` pra derrubar lembretes legados (`NewtonRequest.cronJobIds`).
- Docs: nova seção `docs/newton-integration.md §0` com o escopo atual + efeito colateral nas réguas de locação; `docs/staging-workflow.md` atualizado.

### Mantido de propósito

- `/api/cron/newton-requests/group-match` — só resolve deal↔grupo (`DealGroupLink`), não envia mensagem.
- `notifyDealEvent` e o sweep de `Notification` → WhatsApp: são notificação a corretor/usuário que optou, não captura de dado.

### Pendente (fora deste repo)

- Gate de comportamento no runtime do agente (openclaw na VPS): responder só quando chamado com `@` e limitar a escrita a criação de formulário de negócio. Bloco de política pronto em `docs/newton-escopo-grupos.md`.

## [Unreleased] - 2026-05-16 - Multi-agent orchestrator (F0-F5)

### Adicionado

- **Orquestrador multi-agente** via LangGraph TS — substitui o `streamContractAgent` legacy como caminho principal de chat. 7 nodes (`loadContext`, `router`, `analyst`, `legal`, `editor`, `curator`, `aggregator`) com fanout paralelo para `intent=review` e `propose`. Mantém streaming SSE com formato `AgentEvent` compatível com front-end atual.
- **6 especialistas** em `apps/web/src/lib/ai/specialists/`:
  - `analyst.ts` — Haiku 4.5, read-only (validate_contract, analyze_contradictions, extract_document_data, add_comment, cross_check_certidoes)
  - `legal.ts` — Haiku 4.5, RAG (query_clauses, query_templates, explain_clause, query_knowledge_base, find_similar_contracts)
  - `editor.ts` — Sonnet 4.6, writes gated pelo Sentinel (edit_contract_section, update_contract_data, propose_suggestion, insert_clause, remove_clause, apply_style_preset, insert_image, add_comment, cross_check_certidoes, propose_plan)
  - `curator.ts` — Haiku 4.5, propose-only (propose_new_clause, propose_template_change, find_similar_contracts)
  - `ocr-quarantine.ts` — Gemini + Sentinel classifier (low-priv, sem tools de write)
  - System prompts dedicados em `specialists/prompts.ts` (Analyst/Legal/Editor/Curator)
- **Sentinel** (`apps/web/src/lib/ai/sentinel/`):
  - `policy.yaml` versionada com 3 regras (no_external_url_in_insert_image, no_template_change_without_evidence, budget_exceeded)
  - `policy-engine.ts` parser AST seguro (sem `eval`/`Function`) com tokens, funções (`contains_private_ip`), operadores (==, !=, <, >, >=, MATCHES, AND, OR, NOT)
  - `classifier.ts` regex + Haiku 4.5 fallback contra prompt injection (11 patterns regex, LRU cache 100 entries por hash)
  - `middleware.ts` `applyPolicy(toolCall, state)` + `quarantineAttachment(text, ctx)` — audit `AGENT_TOOL_BLOCKED` / `SENTINEL_ATTACHMENT_QUARANTINED`
- **PostgresSaver checkpointer** — `@langchain/langgraph-checkpoint-postgres@^1.0` no mesmo Neon do Prisma. Tabelas `langgraph_*` criadas via `apps/web/scripts/setup-langgraph-tables.ts`. `thread_id = ChatSession.id` pra time-travel forense.
- **Tool `cross_check_certidoes`** (21ª tool no AGENT_TOOLS) — Analyst e Editor cruzam `CertidaoJob.resultData` × `Contract.dataJson`. 11 categorias de finding (matricula_onus, matricula_vencida, matricula_faltando, vendedor_fiscal_positiva, vendedor_trabalhista_positiva, vendedor_civel_positiva, vendedor_antecedentes_positiva, imovel_iptu_pendente, protesto_vendedor, fgts_pendente, certidao_falhou_portal_manual). Cada finding com `suggested_aditamento` citando base legal (CC arts. 127, 418, 474, 475, 502, 503).
- **Hook automático em `contract-generation.ts`** — após criar contrato, dispara `analyzeCertidoesForContract` fire-and-forget que cria `ContractComment` por finding (dedupe via `dedupeKey`). Usuário vê alertas no editor sem ação manual.
- **Roteamento de aditamento (F4.x polish)** — `ADITAMENTO_REGEX` + nova regra de prompt do Editor (regra 19) ativam ciclo 1-turn: cross_check_certidoes → propose_suggestion. "Proponha aditamento" agora roteia pra Editor (não Curator) por ser write neste contrato.
- **Audit API + UI time-travel** — `GET /api/contracts/[id]/audit` lê histórico via `graph.getStateHistory(sessionId)`; UI server-component em `/contracts/[id]/audit` mostra checkpoints com intent/agents/tools/respostas por turn.
- **Memory service unificado** (`apps/web/src/lib/ai/multi-agent-memory.ts`) — `getTimeline(contractId)` consolida AuditLog + AIUsage + ContractChangeLog; `recordEvent()` helper fire-and-forget.
- **Audit actions novas**: `AGENT_TOOL_BLOCKED`, `SENTINEL_ATTACHMENT_QUARANTINED` em `lib/security/audit.ts`.
- **Doc**: `docs/multi-agent-architecture.md` com fases F0-F5, estrutura de arquivos, gestão das tabelas `langgraph_*` fora do Prisma.
- **Scripts de diagnóstico** em `apps/web/scripts/`: `setup-langgraph-tables.ts`, `test-multi-agent.ts`, `test-f3-curator-and-audit.ts`, `test-f4-crosscheck.ts`, `test-f4-polish-aditamento.ts`, `test-f5-edit-multi.ts`.
- **Tests**: +44 testes (24 Sentinel + 13 routing + 10 crosscheck − 3 atualizados de tools.test). Total 813/813.

### Alterado

- **`apps/web/src/lib/ai/agent.ts`** — `streamContractAgent` marcada `@deprecated` com nota explicando que só permanece pra `runPassiveAnalysis` + `ai-resolve` route (planejado pra F6). Helpers extraídos para `shared/`: `loadContext`, `resolveSession`, `loadChatHistory`, `streamOneTurn`, `mapToolToAction`, `summarizeToolResult`, `getAnthropicClient`, `snapshot` helpers.
- **`apps/web/src/app/api/contracts/[id]/chat/route.ts`** — flag `ENABLE_MULTI_AGENT` agora default `true`. Para rollback emergência, set `ENABLE_MULTI_AGENT=false`. Todos os intents (informational, edit_simple, edit_multi, review, propose) roteiam via graph; edit_multi força Editor com `propose_plan`.
- **`apps/web/src/lib/services/contract-generation.ts`** — adicionado `analyzeCertidoesForContract` chamado fire-and-forget no fim de `generateContractForDeal`.

### Adicionado em schema

- Tabelas `langgraph_*` no Neon (gerenciadas FORA do Prisma — não rodar `prisma db pull`).
- Audit actions enum: `AGENT_TOOL_BLOCKED`, `SENTINEL_ATTACHMENT_QUARANTINED`.

### Dependências

- `@langchain/langgraph@^1.0.0`
- `@langchain/langgraph-checkpoint-postgres@^1.0.0`
- `@langchain/core@^1.0.0`
- `js-yaml@^4.1.0` + `@types/js-yaml@^4.0.9`

### Motivação

Single-agent monolítico em `agent.ts` (1133 linhas, 18 tools, 18 regras de prompt) começou a apresentar:
1. **Anti-prompt-injection** insuficiente — `ChatAttachment.extractedText` entra direto no prompt do mesmo agente que tem tools de write.
2. **Tools demais por turn** — todas as 18 oferecidas mesmo em queries informacionais.
3. **Zero paralelismo em reads** — `validate_contract + query_knowledge_base + find_similar_contracts` serializados.
4. **Audit não replay-able** — sem checkpoint serializado por turn pra time-travel forense em casos de litígio.

Multi-agente resolve os 4 gargalos: tools restritas por especialista, fanout paralelo em review (3 agents simultâneos), Sentinel hard-block em writes que violam policy, PostgresSaver enterprise-grade pra audit/replay (exposição regulatória mitigada).

### Sobre Voyage API key inválida (warning persistente)

Em prod a `VOYAGE_API_KEY` está retornando 401. O multi-agente roda normalmente — `query_knowledge_base` cai em fallback ILIKE e `find_similar_contracts` em fallback fingerprint — mas a qualidade RAG semântica está degradada. Rotacionar antes da release.

## [Unreleased] - 2026-05-07 - Newton extract_document_fields (Phase 3 do plano openclaw)

### Adicionado
- **Endpoint Bearer `POST /api/deals/[dealId]/extract-fields`** (`apps/web/src/app/api/deals/[dealId]/extract-fields/route.ts`) — wrapper pra `classifyAndExtract` (Gemini OCR) com score POR CAMPO. Bearer scope `documents:rw`. Body `{ attachmentId, documentType?, idempotencyKey? }`. Retorna `{ fields[key]: {value, confidence, needsReview, reason}, lowConfidenceFields[], missingRequiredFields[], unknownFields[] }`. Audit `ATTACHMENT_EXTRACT`.
- **Field schemas** (`apps/web/src/lib/extraction/field-schemas.ts`) — 9 documentTypes (rg, cpf, cnh, matricula, iptu, escritura, procuracao, comprovante_residencia, certidao_casamento) com `FieldSpec { key, required, regex?, partialMarkers? }`. Função `scoreField(spec, value)` → confidence 0-1 baseado em (empty + required) / partial markers / regex match. `scoreFields(documentType, rawFields)` agrega + lista `lowConfidenceFields` (needsReview true) e `missingRequiredFields` (required + ausente).
- **Audit action** `ATTACHMENT_EXTRACT` em `apps/web/src/lib/security/audit.ts`.
- **Tool MCP** `extract_document_fields` em `apps/mcp-server/src/tools.ts`. Total Newton: 24 → 25 tools. Wrap do endpoint acima, idempotencyKey opcional.

### Motivação

Newton estava fazendo OCR errada de documento de uma das partes em produção (relato 2026-05-07). `classifyAndExtract` retorna confidence GLOBAL — Newton não sabia quais campos especificamente precisava conferir antes de gravar. Com score por campo + needsReview por campo + persona OCR.md (no repo openclaw), Newton agora recita campos de baixa confiança e pede confirmação antes de chamar `fill_form`.

## [0.3.1] - 2026-04-11 - Deploy e Documentacao

### Adicionado
- Guia de deploy Vercel (`docs/DEPLOYMENT.md`)
- `.env.example` atualizado com todas as variaveis necessarias
- README raiz reescrito para refletir a plataforma web (nao mais CLI)
- `apps/web/README.md` atualizado com rotas, setup Neon e instrucoes de teste

### Corrigido
- `ignoreDeprecations` no tsconfig corrigido de `"6.0"` para `"5.0"` (TS 5.9 compatibility)
- `TextractClient` lazy-initialized para evitar "Region is missing" durante build
- Arquivos de teste excluidos do tsconfig (evita erros de tipo no build)

---

## [0.3.0] - 2026-04-11 - Templates Padronizados e Banco de Clausulas v2

### Adicionado
- **Templates Padronizados v2** baseados nos modelos Zimmermann
  - `ccv_a_vista_v2.hbs` - CCV para pagamento a vista (15 clausulas)
  - `ccv_financiamento_v2.hbs` - CCV para financiamento imobiliario (17 clausulas)
  - Marcadores `<!-- CLAUSE_SLOT:Gx -->` para insercao semantica de clausulas variaveis
  - Template legado v1 marcado como deprecated (contratos existentes preservados)

- **Banco de Clausulas Padronizadas** (23 clausulas em 6 grupos)
  - G1: Sinal, Arras e Inicio de Pagamento (3 clausulas)
  - G2: Imissao na Posse (4 clausulas)
  - G3: Rescisao e Condicao Resolutiva (4 clausulas)
  - G4: Financiamento e Registro (4 clausulas - obrigatorio em financiamento)
  - G5: Comissao de Corretagem (3 clausulas)
  - G6: Declaracoes e Disposicoes Especiais (5 clausulas)
  - Cada clausula com `agentNotes` (orientacao juridica da Zimmermann)

- **Selecao automatica de template por modalidade**
  - Auto-detecta financiamento quando `alienacao_fiduciaria > 0`
  - Campo `modalidade` no schema de validacao (step5)
  - Fallback para template default generico

- **Agente IA aprimorado**
  - System prompt com descricao dos 2 modelos e 6 grupos de clausulas
  - `query_clauses` aceita `groupCode` e `isVariable`, retorna `agentNotes`
  - `suggest_improvements` detecta clausulas obrigatorias: G4 (financiamento), FGTS (G6), socio PJ (G6), pluralidade vendedores (G1)
  - Context do agente inclui `templateModalidade` e `templateName`
  - `insert_clause` posiciona clausulas nos CLAUSE_SLOT:Gx corretos

- **Schema Prisma atualizado**
  - `Clause`: campos `agentNotes`, `groupCode`, `isVariable`
  - `ContractTemplate`: campo `modalidade`
  - Migracao: `add_clause_bank_v2_fields`

- **UI da biblioteca de clausulas aprimorada**
  - Clausulas padronizadas agrupadas por grupo (G1-G6) com labels descritivos
  - Secao colapsavel "Orientacao de uso" mostrando `agentNotes`
  - Badges de grupo e status
  - Clausulas legacy exibidas separadamente como "Clausulas Base"

- **Suite de testes de renderizacao** (21 testes)
  - Verificacao de ambos templates com dados mockados realistas
  - Testes de helpers (moeda, extenso, cpf, cnpj, cep)
  - Testes de renderizacao de clausulas variaveis com dados do contrato

### Corrigido
- `insert_clause` agora usa CLAUSE_SLOT:Gx para posicionamento semantico (antes inseria sempre no final)
- Contratos aprovados nao podem mais ser versionados (retorna 403)
- Registro de novas orgs agora copia ambos templates v2 + 23 clausulas padronizadas

### Alterado
- Pagina de clausulas agora agrupa por `groupCode` ao inves de so por `category`
- `suggest_improvements` substituiu sugestao generica de "Condicao Suspensiva" por verificacao especifica de clausulas G4

---

## [0.2.0] - 2026-04-10 - Esteira de Vendas

### Adicionado
- **Fase 0: Fundacao**
  - Tailwind CSS v3 + Shadcn UI (20+ componentes)
  - NextAuth v5 com Prisma Adapter + Credentials provider (JWT sessions)
  - Prisma schema com 20+ models (Organization, Pipeline, Deal, SalesForm, ContractTemplate, Clause, Contract versionado)
  - Seed script: org default, pipeline 6 stages, template base, 14 clausulas categorizadas
  - Dashboard layout com Sidebar + Header
  - Paginas de login e registro com auto-criacao de org/pipeline/template/clausulas

- **Fase 1: Formulario de Vendas**
  - SalesFormWizard com 7 steps (Vendedor, Comprador, Imovel, Status, Pagamento, Posse, Comissao)
  - Link compartilhavel publico `/f/[token]` (sem autenticacao)
  - Auto-save com debounce 1500ms + indicador visual
  - Suporte a PF/PJ, conjuge, procurador, arrays dinamicos

- **Fase 2: Pipeline Kanban**
  - KanbanBoard com @dnd-kit drag-and-drop entre colunas
  - DealDetail com tabs (Dados, Anexos, Contratos)
  - Criacao de deal a partir de formulario completo
  - Auto-move para stage "Contrato" ao gerar contrato

- **Fase 3: Contratos + Clausulas**
  - Botao "Confeccionar Contrato" (Handlebars + dados do form)
  - Biblioteca de 14 clausulas em 9 categorias
  - API de geracao de clausulas com Claude AI (pending -> approved)
  - CRUD completo de clausulas com filtros

- **Fase 4: Editor + Chat IA**
  - Editor TipTap com toolbar (bold, italic, headings, listas, tabelas, alinhamento)
  - ChatPanel com IA para editar contratos via linguagem natural
  - Versionamento de contratos (linked-list, isLatest flag)
  - VersionTimeline no painel lateral

- **Fase 5: Export**
  - ExportDialog com opcoes PDF e DOCX
  - Historico de exportacoes anteriores

### Corrigido
- TipTap SSR hydration error (`immediatelyRender: false`)
- Registro de usuario nao copiava template e clausulas para nova org
- Campos legados renomeados (handlebarsTemplate -> handlebarsSource, htmlPreview -> htmlContent)
- Anthropic SDK tool type error (type: 'object' as const)

### Bugs Conhecidos
- Secao 8 do contrato (penalidades) mostra campos config vazios quando nao preenchidos
- Helper `extenso` nao implementado (valores por extenso mostram numero entre parenteses)

---

## [0.1.0] - MVP Original (pre-esteira)

### Existente
- Upload DOCX/PDF com extracao de texto (mammoth, pdf-parse)
- Analise por IA (Claude) para identificar campos e condicionais
- UI de mapeamento manual (standalone HTML)
- Chat de edicao com tool-use (update_data_patch, propose_clause_edit)
- Renderizacao via Handlebars com helpers brasileiros
- Export PDF (Puppeteer) e DOCX (html-to-docx)
- PostgreSQL + Prisma (User, Document, Template, Contract, Export, ChatSession, ChatMessage)
- Auth basica com bcryptjs (sem sessoes)
- Storage S3 ou local
- Template unico: contrato_compra_venda.hbs
